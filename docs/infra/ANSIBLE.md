# Ansible

Status: IN PROGRESS (slice A of 9.2) · Owner: Evan · Last updated: 2026-10-06

Ansible keeps the **production server's own settings** as code in
`ops/ansible/`. [SERVER.md](SERVER.md) records 21 steps that were typed
by hand over SSH; the playbook is those steps, written so a computer can
repeat them. It can **check** the real server against the code without
changing anything, and it can turn a fresh Ubuntu machine into a copy of
the server.

Terraform ([TERRAFORM.md](TERRAFORM.md)) does the same for the Cloudflare
and AWS accounts. Ansible is for the machine itself.

---

## Words you need

| Word            | Meaning                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Playbook**    | The list of what the server should look like (`site.yml`).                                                           |
| **Role**        | One topic of the playbook, e.g. `ssh` or `swap`. One role per SERVER.md section; each role's tasks name its section. |
| **Task**        | One step in a role: "this file has this content", "this package is installed".                                       |
| **Inventory**   | Which machines to run on: `production` (the VPS, through your `ssh echoandaura` alias) or `lab` (a VM on your Mac).  |
| **Check mode**  | A preview. Ansible logs in, compares, and reports what it _would_ change. Changes nothing. Like `terraform plan`.    |
| **`changed=0`** | The best answer from check mode: the server already matches the code exactly.                                        |
| **Idempotent**  | Running it twice is safe: the second run changes nothing. Every role here must be.                                   |
| **Handler**     | A follow-up that runs only if a task changed something, e.g. "reload SSH" only when its config changed.              |

## Layout

```
ops/ansible/
  site.yml               the playbook: which roles, in which order
  roles/<name>/tasks/    the steps (each file says which SERVER.md § it is)
  roles/<name>/files/    files copied as they are (e.g. 00-hardening.conf)
  group_vars/all.yml     values shared by lab and production (hostname, swap size)
  inventory/             production.yml (committed); lab.yml (written by lab.sh)
  pyproject.toml, uv.lock   ansible-core 2.21.5 + ansible-lint 26.9.0, pinned
  requirements.yml       collections ansible.posix 2.2.2, community.general 13.5.0
  run.sh, lab.sh         the two scripts behind the pnpm commands below
```

The tools install into `ops/ansible/.venv` with `uv` (no global
install), and the collections into `ops/ansible/collections`. Both are
git-ignored and appear on the first run.

## What is managed

| Role   | SERVER.md | What                                                                                          | Since      |
| ------ | --------- | --------------------------------------------------------------------------------------------- | ---------- |
| `base` | § 4, § 5  | hostname, `/etc/hosts`, cloud-init keeps the name, UTC, automatic security updates            | 2026-10-06 |
| `ssh`  | § 2       | your public key for root; keys only (`00-hardening.conf`, checked by `sshd -t` before saving) | 2026-10-06 |
| `swap` | § 3       | 2 GB `/swapfile` (created only if missing), in fstab, swappiness 10                           | 2026-10-06 |

Coming in the next slices: firewall, Docker log limits, kernel settings,
apt cleaning, the disk alert, origin lockdown, Traefik's in-flight cap,
and the Dokploy install. **Never** in Ansible: Dokploy's own settings
(projects, databases, the compose app, its environment, backup schedules
live in Dokploy's database) and the app's database role (needs the DB
password). SERVER.md keeps those as manual steps.

## Before you start (once per laptop)

1. `uv` (already on this Mac: `uv --version`).
2. Your SSH alias `echoandaura` works: `ssh echoandaura hostname`.
3. Your public key at `~/.ssh/echoandaura_vps.pub`, or set
   `ANSIBLE_SSH_PUBLIC_KEY=/path/to/key.pub` in `.env`.
4. For the lab: Multipass, `brew install --cask multipass`.

## The four speeds of testing

| How                          | Command                             | Time      | Touches    |
| ---------------------------- | ----------------------------------- | --------- | ---------- |
| Lint + syntax                | `pnpm ansible lint`                 | ~5 s      | nothing    |
| One role on the lab VM       | `pnpm ansible apply lab --tags ssh` | ~20–40 s  | the lab VM |
| Full run twice (idempotent?) | `pnpm ansible:lab test`             | a few min | the lab VM |
| Production preview           | `pnpm ansible check production`     | ~25 s     | reads only |

**The lab VM** is a copy of the server on your Mac (2 CPUs, 4 GB, 25 GB,
Ubuntu 24.04, root logs in with your key). `pnpm ansible:lab create` makes
it once and saves a snapshot called `fresh`; `pnpm ansible:lab reset`
goes back to it in seconds, so you never wait for a rebuild. Save your
own snapshots with `pnpm ansible:lab snapshot <name>` (e.g. after the slow
Dokploy install). It runs ARM (Apple silicon) while production is x86:
the roles don't care, and production check mode is the final word.

## Making a change to the server

1. Edit the role on a branch.
2. `pnpm ansible lint`.
3. `pnpm ansible:lab reset`, then `pnpm ansible:lab test`: must end with
   `OK: the second run changed nothing.`
4. `pnpm ansible check production`: read the `--diff` output. It shows
   exactly what would change on the server, line by line.
5. Open the PR with that output's summary; CI runs `ansible` (lint).
6. After merge: `pnpm ansible apply production`. It asks you to type
   `echoandaura` first. Keep a second SSH window open when the change
   touches SSH or the firewall.
7. `pnpm ansible check production` again: **`changed=0`**.
8. A row in SERVER.md's History and this page's.

**Never change a managed setting by hand over SSH.** The next apply puts
it back. In an emergency, change it by hand, then copy the change into
the role the same day; check mode shows `changed=0` once they match.

## When something goes wrong

- **`UNREACHABLE`**: `ssh echoandaura` doesn't work either → fix SSH first
  (SERVER.md § Getting in). Lab: `pnpm ansible:lab reset` rewrites its
  address.
- **Check mode says `changed=1` or more on production, and nobody changed
  the role**: the server drifted. Read the diff, find out who changed it
  and why, then either apply (the code wins) or update the role (the
  server wins). Never apply blindly.
- **`CERTIFICATE_VERIFY_FAILED` from Galaxy** on a new Mac: `run.sh` uses
  `/etc/ssl/cert.pem`; if it still fails, install certificates for that
  Python (python.org: _Install Certificates.command_).

## History

| Date       | Change                                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-06 | Slice A: `ops/ansible/`, roles `base`, `ssh`, `swap`, lab VM scripts, CI `ansible` (lint). Production check mode: **ok=13 changed=0** on the first run. Lab VM (Multipass, from `fresh`): full run, then a second run changed nothing |
