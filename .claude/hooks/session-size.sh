#!/usr/bin/env bash
# UserPromptSubmit: once the context passes 150k tokens, tell Claude to close
# the session cleanly. Every turn re-sends the whole context, so a long
# session costs more per prompt and recalls its start less well; /prime in a
# fresh one costs a fraction (the 2026-10-14 session reached ~355k).
# Below the limit it prints nothing. Never blocks the prompt.
# Tests: tests/unit/claude-workspace.test.ts.
set -uo pipefail

LIMIT=150000
here=$(cd "$(dirname "$0")" && pwd)
transcript=$(jq -r '.transcript_path // empty' 2>/dev/null || true)
tokens=$("$here/context-tokens.sh" "$transcript")
[ -n "$tokens" ] && [ "$tokens" -ge "$LIMIT" ] 2>/dev/null || exit 0

jq -n --arg k "$((tokens / 1000))" '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: ("The context is about \($k)k tokens, past the 150k limit for this repo. Finish the step in progress (do not start a new one), update the RESUME HERE block in notes/PROGRESS.md so a fresh session can continue, then tell the owner to run /clear and then /prime.")
  }
}'
exit 0
