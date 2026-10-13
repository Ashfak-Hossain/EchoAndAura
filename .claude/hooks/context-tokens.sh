#!/usr/bin/env bash
# Prints how many tokens the session's context holds: the last main-thread
# assistant turn's input + cache_creation_input + cache_read_input, read from
# the transcript Claude Code passes as `transcript_path`. Every turn re-sends
# the whole context, so this number is what each prompt costs.
#
#   context-tokens.sh <transcript.jsonl>   →   95321
#
# Prints nothing and exits 0 when the file is missing or has no such turn.
# Subagent turns (isSidechain) are skipped: they have their own context.
# Only the last 300 lines are read, so a long transcript stays fast; a line
# cut off mid-write is skipped (`fromjson?`).
# Used by statusline.sh and session-size.sh; tests: claude-workspace.test.ts.
set -uo pipefail

file=${1:-}
[ -n "$file" ] && [ -r "$file" ] || exit 0
tail -n 300 "$file" 2>/dev/null |
  jq -R -r 'fromjson?
    | select(.type == "assistant" and (.isSidechain | not) and (.message.usage | type) == "object")
    | .message.usage
    | (.input_tokens // 0) + (.cache_creation_input_tokens // 0) + (.cache_read_input_tokens // 0)' 2>/dev/null |
  tail -n 1
exit 0
