#!/usr/bin/env bash
# Codex PreToolUse guard: preserve the project's protected edit boundaries and
# block added lines that look like committed secrets.
# Exit 2 = deny the tool call. Exit 0 = allow.
#
# The patterns follow the secrets this project actually has
# (docs/infra/SECRETS.md). AWS's documented example keys (…EXAMPLE…) and
# local connection strings are allowed: the deploy smoke test and the
# docs use them on purpose.
set -uo pipefail

input=$(mktemp)
trap 'rm -f "$input"' EXIT
cat >"$input"

command=$(jq -r '.tool_input.command // empty' "$input" 2>/dev/null || true)
direct_content=$(jq -r '.tool_input.content // .tool_input.new_string // empty' "$input" 2>/dev/null || true)

deny() {
  printf 'BLOCKED: %s\n' "$1" >&2
  exit 2
}

if [ -n "$command" ]; then
  repo_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
  paths=$(printf '%s\n' "$command" | sed -nE 's/^\*\*\* (Add|Update|Delete) File: (.*)$/\2/p')

  while IFS= read -r path; do
    [ -n "$path" ] || continue
    relative_path=${path#"$repo_root"/}

    case "$relative_path" in
      .env.example) ;;
      .env | .env.*)
        deny "Codex may not edit local environment files. Update .env.example when documenting configuration."
        ;;
      drizzle/*)
        deny "Do not edit generated migrations by hand. Run pnpm db:generate."
        ;;
      src/components/ui/*)
        deny "Do not hand-edit shadcn-generated UI files. Re-run the shadcn CLI."
        ;;
    esac
  done <<EOF
$paths
EOF

  # apply_patch carries the whole patch in tool_input.command. Only scan added
  # lines so removing an accidentally committed secret remains possible.
  content=$(printf '%s\n' "$command" | awk '
    /^\+/ && !/^\+\+\+/ { print substr($0, 2) }
  ')
else
  content=$direct_content
fi

[ -z "$content" ] && exit 0

patterns=(
  # AWS access key ids (SES worker key)
  '(AKIA|ASIA)[0-9A-Z]{16}'
  # Named secrets assigned a real-looking value (SES, R2, auth, Dokploy)
  '(SECRET_ACCESS_KEY|BETTER_AUTH_SECRET|DOKPLOY_API_KEY|TELEGRAM_BOT_TOKEN)[[:space:]]*[=:][[:space:]]*["'"'"']?[A-Za-z0-9/+_]{20,}'
  # Postgres / Redis URLs carrying a password
  '(postgres(ql)?|rediss?)://[^:/@[:space:]]*:[^@[:space:]]{8,}@[^/:[:space:]]+'
  # Private keys (SSH, TLS)
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  # GitHub tokens
  'gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,}'
  # Telegram bot tokens
  '[0-9]{8,10}:AA[A-Za-z0-9_-]{30,}'
)
# Matches that are safe to commit: AWS's example keys, local services.
allowed='EXAMPLE|@(localhost|127\.0\.0\.1|postgres|redis)([:/]|$)'

for p in "${patterns[@]}"; do
  hits=$(printf '%s' "$content" | grep -oE -- "$p" | grep -vE -- "$allowed" || true)
  if [ -n "$hits" ]; then
    deny "this edit appears to contain a hardcoded secret. Put it in .env or Bitwarden and read it at run time."
  fi
done
exit 0
