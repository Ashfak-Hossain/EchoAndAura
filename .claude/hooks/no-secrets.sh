#!/usr/bin/env bash
# PreToolUse guard: block writes that look like committed secrets.
# Exit 2 = deny the tool call. Exit 0 = allow.
set -uo pipefail

input=$(cat)
content=$(printf '%s' "$input" | grep -oE '"(content|new_string)"[[:space:]]*:[[:space:]]*".*"' || true)

patterns=(
  'BKASH_APP_SECRET[[:space:]]*=[[:space:]]*["'"'"'][^"'"'"']'
  'RESEND_API_KEY[[:space:]]*=[[:space:]]*["'"'"']re_'
  'AKIA[0-9A-Z]{16}'
  'BETTER_AUTH_SECRET[[:space:]]*=[[:space:]]*["'"'"'][^"'"'"']'
  'postgres://[^:]+:[^@]+@'
)

for p in "${patterns[@]}"; do
  if printf '%s' "$content" | grep -qE "$p"; then
    echo "BLOCKED: this write appears to contain a hardcoded secret." >&2
    echo "Put it in .env and read it from process.env instead." >&2
    exit 2
  fi
done
exit 0
