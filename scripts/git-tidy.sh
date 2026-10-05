#!/usr/bin/env bash
# Keeps the local repository tidy. Runs at the start of every Claude Code
# session (.claude/settings.json, SessionStart) and by hand:
#
#   pnpm git:tidy                 what it did, and anything that needs you
#   scripts/git-tidy.sh --hook    the same as one line, as hook JSON
#
# Safe by design. It never commits, pushes, resets or stashes, and it only
# deletes a local branch when GitHub has deleted it AND every commit on it
# is already in GitHub's main (the repo merges with merge commits, so a
# merged branch is an ancestor of main). Anything else is reported, not
# touched. GitHub deletes merged branches by itself
# (delete_branch_on_merge), so this is the local half.
#
# Written for macOS's bash 3.2: no `set -u` (empty arrays), no mapfile.

hook=false
[ "${1:-}" = "--hook" ] && hook=true

done_list=""
need_list=""
did() { done_list="${done_list:+$done_list; }$1"; }
needs() { need_list="${need_list:+$need_list; }$1"; }

finish() {
  if $hook; then
    line="git: ${done_list:-clean}${need_list:+ | needs you: $need_list}"
    esc=$(printf '%s' "$line" | sed 's/\\/\\\\/g; s/"/\\"/g')
    printf '{"systemMessage":"%s","hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$esc" "$esc"
  else
    echo "Done: ${done_list:-nothing to tidy}"
    [ -n "$need_list" ] && echo "Needs you: $need_list"
  fi
  exit 0
}

root=$(git rev-parse --show-toplevel 2>/dev/null) || finish
cd "$root" || finish

# 1. Forget branches GitHub deleted, now and on every future fetch.
[ "$(git config --get fetch.prune)" = "true" ] || git config fetch.prune true
if ! git fetch --quiet --prune origin 2>/dev/null; then
  needs "could not reach GitHub (offline?), nothing changed"
  finish
fi

current=$(git branch --show-current)
dirty=$(git status --porcelain | wc -l | tr -d ' ')

# 2. If the branch you are on is finished (merged, deleted on GitHub) and
#    nothing is uncommitted, step back to main so it can be removed.
if [ -n "$current" ] && [ "$current" != main ]; then
  track=$(git for-each-ref --format='%(upstream:track)' "refs/heads/$current")
  if [ "$track" = "[gone]" ] && git merge-base --is-ancestor "$current" origin/main; then
    if [ "$dirty" = 0 ]; then
      git switch --quiet main && did "left merged $current for main" && current=main
    else
      needs "$current is merged but has $dirty uncommitted file(s)"
    fi
  fi
fi

# 3. Local main follows GitHub's main, fast-forward only (never rewrites).
behind=$(git rev-list --count main..origin/main 2>/dev/null || echo 0)
ahead=$(git rev-list --count origin/main..main 2>/dev/null || echo 0)
if [ "$ahead" != 0 ]; then
  needs "local main has $ahead commit(s) GitHub's main doesn't, not updated"
elif [ "$behind" != 0 ]; then
  if [ "$current" = main ]; then
    if [ "$dirty" = 0 ]; then
      git merge --ff-only --quiet origin/main && did "main +$behind"
    else
      needs "main is $behind behind but has uncommitted changes"
    fi
  else
    git fetch --quiet origin main:main && did "main +$behind"
  fi
fi

# 4. Delete local branches that GitHub deleted and main already contains.
removed=0
for b in $(git for-each-ref --format='%(refname:short) %(upstream:track)' refs/heads | awk '$2=="[gone]" {print $1}'); do
  [ "$b" = "$current" ] && continue
  if git merge-base --is-ancestor "$b" origin/main; then
    git branch -D "$b" >/dev/null && removed=$((removed + 1))
  else
    needs "$b was deleted on GitHub but has commits main doesn't, kept"
  fi
done
[ "$removed" != 0 ] && did "removed $removed merged branch(es)"

# 5. Report only: work that exists nowhere else yet.
if [ -n "$current" ] && [ "$current" != main ]; then
  if git rev-parse --verify --quiet "refs/remotes/origin/$current" >/dev/null; then
    unpushed=$(git rev-list --count "origin/$current..$current")
    [ "$unpushed" != 0 ] && needs "$unpushed unpushed commit(s) on $current"
  else
    needs "$current is not on GitHub yet"
  fi
fi
[ "$dirty" != 0 ] && [ "$current" != main ] && did "on $current, $dirty uncommitted file(s)"
[ "$current" = main ] && [ "$dirty" = 0 ] && did "on main"

finish
