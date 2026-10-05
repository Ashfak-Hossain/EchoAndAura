#!/usr/bin/env bash
# Runs the playbook with the pinned tools (docs/infra/ANSIBLE.md).
#
#   pnpm ansible lint                    lint + syntax check (no server)
#   pnpm ansible check <lab|production>  what would change; changes nothing
#   pnpm ansible apply <lab|production>  make the changes
#
# Extra arguments go to ansible-playbook, e.g. --tags ssh.
set -euo pipefail
cd "$(dirname "$0")"

mode=${1:-}
shift || true

# Some Pythons on macOS (the python.org installer) ship without a CA
# bundle, so HTTPS to Galaxy fails. Use the system's when it has one.
if [[ -z ${SSL_CERT_FILE:-} && -f /etc/ssl/cert.pem ]]; then
  export SSL_CERT_FILE=/etc/ssl/cert.pem
fi

# Tools from uv.lock into .venv, collections from requirements.yml into
# ./collections. Both are quick no-ops once installed.
uv sync --frozen --quiet
uv run --frozen ansible-galaxy collection install -r requirements.yml -p collections >/dev/null

case "$mode" in
  lint)
    uv run --frozen ansible-lint
    uv run --frozen ansible-playbook -i inventory/production.yml site.yml --syntax-check
    ;;
  check|apply)
    target=${1:?"usage: pnpm ansible $mode <lab|production> [ansible-playbook args]"}
    shift
    inventory="inventory/$target.yml"
    [[ -f $inventory ]] || { echo "No $inventory (for the lab: pnpm ansible:lab create)" >&2; exit 1; }
    if [[ $mode == check ]]; then
      uv run --frozen ansible-playbook -i "$inventory" site.yml --check --diff "$@"
    else
      if [[ $target == production ]]; then
        # A deliberate pause: check first, read it, then type the name.
        echo "This CHANGES the production server. Run 'pnpm ansible check production' first."
        read -r -p "Type echoandaura to continue: " answer
        [[ $answer == echoandaura ]] || { echo "Stopped."; exit 1; }
      fi
      uv run --frozen ansible-playbook -i "$inventory" site.yml --diff "$@"
    fi
    ;;
  *)
    sed -n '2,9p' "$0" >&2
    exit 1
    ;;
esac
