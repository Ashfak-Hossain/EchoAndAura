#!/usr/bin/env bash
# Codex PostToolUse hook: run Prettier on files changed by apply_patch.
# Codex provides the patch in tool_input.command, so extract its file markers.
# Never fails the tool call: an unformattable file is left as it is.
set -uo pipefail

input=$(mktemp)
trap 'rm -f "$input"' EXIT
cat >"$input"

command=$(jq -r '.tool_input.command // empty' "$input" 2>/dev/null || true)
[ -n "$command" ] || exit 0

repo_root=$(git rev-parse --show-toplevel 2>/dev/null || exit 0)
paths=$(printf '%s\n' "$command" | sed -nE 's/^\*\*\* (Add|Update) File: (.*)$/\2/p; s/^\*\*\* Move to: (.*)$/\1/p')

while IFS= read -r path; do
  [ -n "$path" ] || continue

  case "$path" in
    /*) target=$path ;;
    *) target="$repo_root/$path" ;;
  esac

  case "$target" in
    "$repo_root"/*) ;;
    *) continue ;;
  esac

  [ -f "$target" ] || continue
  pnpm exec prettier --write --ignore-unknown --log-level silent "$target" || true
done <<EOF
$paths
EOF

exit 0
