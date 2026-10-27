#!/usr/bin/env bash
# ADR-089: one module's `terraform plan`, reduced to one word on stdout and
# in $GITHUB_OUTPUT: clean, drift or failed.
#
# The plan's own output never leaves this script. The repository is public,
# so its Actions logs are too, and a plan (or an error) prints resource ids,
# the account id and email addresses. It goes to a temp file that nothing
# reads and that is deleted on exit. Details: `pnpm tf:<module> plan` locally.
#
# Usage: ops/terraform/drift-plan.sh aws|cloudflare
set -uo pipefail

module="${1:-}"
case "$module" in
  aws | cloudflare) ;;
  *)
    echo "usage: $0 aws|cloudflare" >&2
    exit 64
    ;;
esac

log="$(mktemp)"
trap 'rm -f "$log"' EXIT
cd "$(dirname "$0")/$module" || exit 1

# -lockfile=readonly: providers only from the committed lock file.
# -lock=false: taking the state lock writes to the bucket, and the role
# can't write. A plan changes nothing, so it needs no lock.
# -detailed-exitcode: 0 = no changes, 2 = changes, anything else = error.
if terraform init -input=false -lockfile=readonly >"$log" 2>&1; then
  terraform plan -input=false -lock=false -detailed-exitcode -no-color >"$log" 2>&1
  case $? in
    0) result=clean ;;
    2) result=drift ;;
    *) result=failed ;;
  esac
else
  result=failed
fi

echo "$module: $result"
echo "result=$result" >>"${GITHUB_OUTPUT:-/dev/null}"
