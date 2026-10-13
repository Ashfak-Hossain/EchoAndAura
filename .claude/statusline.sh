#!/usr/bin/env bash
# Claude Code status line (.claude/settings.json → statusLine).
#   echo&aura · chore/x · v1.0.0 (last tag v0.9.0) · 3 changed · ctx 132k · wrap up soon
# Local reads only (no network), so it never slows the prompt down.
# ctx is the session's context size (hooks/context-tokens.sh): at 120k it
# says to wrap up, at 180k to start a new session (/clear, then /prime).
here=$(cd "$(dirname "$0")" && pwd)
transcript=$(jq -r '.transcript_path // empty' 2>/dev/null || true)
tokens=$("$here/hooks/context-tokens.sh" "$transcript")

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
branch=$(git branch --show-current 2>/dev/null)
version=$(sed -nE 's/^[[:space:]]*"version":[[:space:]]*"([^"]+)".*/\1/p' package.json 2>/dev/null | head -1)
tag=$(git describe --tags --abbrev=0 2>/dev/null)
changed=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

line="echo&aura"
[ -n "$branch" ] && line="$line · $branch"
[ -n "$version" ] && line="$line · v$version"
[ -n "$tag" ] && [ "$tag" != "v$version" ] && line="$line (last tag $tag)"
[ "${changed:-0}" != 0 ] && line="$line · $changed changed"
if [ -n "$tokens" ]; then
  line="$line · ctx $((tokens / 1000))k"
  if [ "$tokens" -ge 180000 ]; then
    line="$line · new session now"
  elif [ "$tokens" -ge 120000 ]; then
    line="$line · wrap up soon"
  fi
fi
printf '%s' "$line"
