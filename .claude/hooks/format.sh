#!/usr/bin/env bash
# PostToolUse: run Prettier on the file Claude just wrote or edited.
# The path comes from the hook's JSON input (tool_input.file_path); the old
# `$CLAUDE_FILE_PATHS` variable was never set, so the hook formatted nothing.
# Never fails the tool call: an unformattable file is left as it is.
set -uo pipefail

file=$(jq -r '.tool_input.file_path // empty' 2>/dev/null || true)
[ -n "$file" ] && [ -f "$file" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" && pnpm exec prettier --write --ignore-unknown --log-level silent "$file" || true
exit 0
