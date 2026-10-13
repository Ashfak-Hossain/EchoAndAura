#!/usr/bin/env bash
# PreToolUse guard: block writes that look like committed secrets.
# Exit 2 = deny the tool call. Exit 0 = allow.
#
# The patterns follow the secrets this project actually has
# (docs/infra/SECRETS.md). AWS's documented example keys (…EXAMPLE…),
# Cloudflare's published Turnstile test keys, local connection strings,
# `<password>` placeholders and a value that only names another constant
# are allowed: the smoke test,
# the tests and the docs use them on purpose.
# Tests: tests/unit/claude-hooks.test.ts.
set -uo pipefail

content=$(jq -r '.tool_input.content // .tool_input.new_string // empty' 2>/dev/null || true)
[ -z "$content" ] && exit 0

patterns=(
  # AWS access key ids (SES worker key)
  '(AKIA|ASIA)[0-9A-Z]{16}'
  # Named secrets assigned a real-looking value (SES, R2, auth, Dokploy,
  # Cloudflare, Sentry, the gate relay, Turnstile, Postgres)
  '(SECRET_ACCESS_KEY|BETTER_AUTH_SECRET|DOKPLOY_API_KEY|TELEGRAM_BOT_TOKEN|CLOUDFLARE_[A-Z_]*API_TOKEN|CF_ACCESS_CLIENT_SECRET|SENTRY_AUTH_TOKEN|RELAY_SECRET|TURNSTILE_SECRET_KEY|POSTGRES_PASSWORD)[[:space:]]*[=:][[:space:]]*["'"'"']?[A-Za-z0-9/+_]{20,}'
  # Postgres / Redis URLs carrying a password
  '(postgres(ql)?|rediss?)://[^:/@[:space:]]*:[^@[:space:]]{8,}@[^/:[:space:]]+'
  # Private keys (SSH, TLS)
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  # GitHub tokens
  'gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,}'
  # Telegram bot tokens
  '[0-9]{8,10}:AA[A-Za-z0-9_-]{30,}'
  # Sentry auth tokens (org and user)
  'sntry[su]_[A-Za-z0-9_=+/-]{20,}'
)
# Matches that are safe to commit: AWS's example keys, Turnstile's test
# keys, local services, `<placeholder>` passwords in docs, and a value that
# is only another constant's name.
allowed='EXAMPLE|[123]x0{20,}AA|:<[^>@]+>@|@(localhost|127\.0\.0\.1|postgres|redis)([:/]|$)|[=:][[:space:]]*[A-Z][A-Z0-9_]*$'

for p in "${patterns[@]}"; do
  hits=$(printf '%s' "$content" | grep -oE -- "$p" | grep -vE -- "$allowed" || true)
  if [ -n "$hits" ]; then
    echo "BLOCKED: this write appears to contain a hardcoded secret." >&2
    echo "Put it in .env (or Bitwarden) and read it from process.env instead." >&2
    exit 2
  fi
done
exit 0
