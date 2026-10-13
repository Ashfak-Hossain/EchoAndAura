#!/usr/bin/env bash
# Claude Code status line (.claude/settings.json → statusLine).
#   echo&aura · chore/x · v1.0.0 (tag v1.0.0) · 3 changed
# Local reads only (no network), so it never slows the prompt down.
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
printf '%s' "$line"
