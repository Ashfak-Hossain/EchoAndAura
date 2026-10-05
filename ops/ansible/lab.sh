#!/usr/bin/env bash
# A throwaway copy of the server on this Mac (Multipass, Ubuntu 24.04), to
# test the playbook without touching production (docs/infra/ANSIBLE.md).
#
#   pnpm ansible:lab create          make the VM, save snapshot "fresh"
#   pnpm ansible:lab reset [name]    back to a snapshot in seconds (default fresh)
#   pnpm ansible:lab snapshot <name> save the current state (e.g. with-dokploy)
#   pnpm ansible:lab test            full run, then a second run must change nothing
#   pnpm ansible:lab ssh             a root shell on the VM
#   pnpm ansible:lab delete          remove the VM and its snapshots
#
# The VM is ARM (Apple silicon); production is x86. Roles don't care, but
# production check mode stays the final word.
set -euo pipefail
cd "$(dirname "$0")"

vm=echoandaura-lab
key_file=${ANSIBLE_SSH_PUBLIC_KEY:-$HOME/.ssh/echoandaura_vps.pub}

write_inventory() {
  local ip
  ip=$(multipass info "$vm" --format csv | awk -F, 'NR==2 {print $3}')
  # The lab's address and host key change with every VM: don't pin them.
  cat > inventory/lab.yml <<YAML
# Written by lab.sh; git-ignored.
all:
  hosts:
    echoandaura-lab:
      ansible_host: $ip
      ansible_user: root
      ansible_ssh_common_args: -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
YAML
  echo "Lab VM at $ip (inventory/lab.yml)"
}

stop_and() { multipass stop "$vm"; "$@"; multipass start "$vm"; }

case "${1:-}" in
  create)
    command -v multipass >/dev/null || { echo "Install Multipass first: brew install --cask multipass" >&2; exit 1; }
    [[ -f $key_file ]] || { echo "No public key at $key_file" >&2; exit 1; }
    user_data=$(mktemp)
    # Root logs in with the same key as production, like a fresh VPS.
    printf '#cloud-config\ndisable_root: false\nusers:\n  - default\n  - name: root\n    ssh_authorized_keys:\n      - %s\n' \
      "$(cat "$key_file")" > "$user_data"
    # Sized like production today: 2 vCPU, 4 GB, 25 GB.
    multipass launch 24.04 --name "$vm" --cpus 2 --memory 4G --disk 25G --cloud-init "$user_data"
    rm -f "$user_data"
    stop_and multipass snapshot "$vm" --name fresh
    write_inventory
    ;;
  reset)
    name=${2:-fresh}
    stop_and multipass restore "$vm.$name" --destructive
    write_inventory
    ;;
  snapshot)
    name=${2:?"usage: pnpm ansible:lab snapshot <name>"}
    stop_and multipass snapshot "$vm" --name "$name"
    ;;
  test)
    ./run.sh apply lab
    # Idempotent: a second run on a configured server must change nothing,
    # exactly what production check mode will demand.
    out=$(./run.sh apply lab | tee /dev/stderr)
    grep -Eq 'changed=0 .*failed=0' <<<"$out" || { echo "Second run changed something: not idempotent." >&2; exit 1; }
    echo "OK: the second run changed nothing."
    ;;
  ssh)
    write_inventory >/dev/null
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "root@$(awk '/ansible_host/ {print $2}' inventory/lab.yml)"
    ;;
  delete)
    multipass delete --purge "$vm"
    rm -f inventory/lab.yml
    ;;
  *)
    sed -n '2,13p' "$0" >&2
    exit 1
    ;;
esac
