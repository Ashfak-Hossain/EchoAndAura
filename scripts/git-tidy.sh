#!/usr/bin/env bash
# Keeps the local repository tidy. Runs at the start of every Claude Code
# session (.claude/settings.json, SessionStart) and by hand:
#
#   pnpm git:tidy                 what it did, and anything that needs you
#   scripts/git-tidy.sh --hook    the same as one line, as hook JSON
#
# Safe by design. It never commits, pushes, resets or stashes, and it only
# deletes a local branch when GitHub has deleted it AND main already holds
# its work (merged_into_main below). Anything else is reported, not
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

# True when origin/main already holds everything on branch $1.
# - An ancestor of main: branches merged with merge commits (before
#   ADR-090), or a branch with nothing new.
# - Squashed (ADR-090, squash merges only): the squash commit is new, so
#   the branch is never an ancestor. patch-id finds the candidate: a commit
#   on main since the fork point whose change matches the branch's whole
#   change. But patch-id ignores whitespace (and, in older git, binary
#   content and file modes), so the proof is exact: that commit's tree
#   equals the branch on every path the branch changed, and outside those
#   paths the branch is still the fork point. Read-only, writes no objects.
#   A branch with anything added after its squash fails the proof and is
#   kept. The plain-diff flags stop user config (color, external diff,
#   textconv) from changing what is compared.
merged_into_main() {
  git merge-base --is-ancestor "$1" origin/main && return 0
  _mim_base=$(git merge-base "$1" origin/main) || return 1
  _mim_want=$(git diff --no-color --no-ext-diff --no-textconv "$_mim_base" "$1" |
    git patch-id --stable | cut -d' ' -f1)
  [ -n "$_mim_want" ] || return 1
  for _mim_c in $(git diff --no-renames --name-only -z "$_mim_base" "$1" |
    xargs -0 git log -p --no-merges --no-color --no-ext-diff --no-textconv \
      --format='commit %H' "$_mim_base..origin/main" -- |
    git patch-id --stable | awk -v w="$_mim_want" '$1 == w {print $2}'); do
    git diff --no-renames --name-only -z "$_mim_base" "$1" |
      xargs -0 git diff --quiet --no-ext-diff --no-textconv "$_mim_c" "$1" -- && return 0
  done
  return 1
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
  if [ "$track" = "[gone]" ] && merged_into_main "$current"; then
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
  if merged_into_main "$b"; then
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
