# Ansible

Status: IN PROGRESS (slice D of 9.2) · Owner: Evan · Last updated: 2026-10-06

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

| Role              | SERVER.md  | What                                                                                                                                                                                                                                                                                                                                                              | Since      |
| ----------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `base`            | § 4, § 5   | hostname, `/etc/hosts`, cloud-init keeps the name, UTC, automatic security updates                                                                                                                                                                                                                                                                                | 2026-10-06 |
| `ssh`             | § 2        | your public key for root; keys only (`00-hardening.conf`, checked by `sshd -t` before saving)                                                                                                                                                                                                                                                                     | 2026-10-06 |
| `swap`            | § 3        | 2 GB `/swapfile` (created only if missing), in fstab, swappiness 10                                                                                                                                                                                                                                                                                               | 2026-10-06 |
| `firewall`        | § 6, 9, 20 | ufw: SSH allowed **first**, deny incoming/routed, allow outgoing, 80/443/3000 kept closed, logging low, on                                                                                                                                                                                                                                                        | 2026-10-06 |
| `docker_config`   | § 7        | `/etc/docker/daemon.json`: container logs capped at 3 × 10 MB. **Never restarts Docker** (that stops the site): it prints a reminder to restart at a quiet time                                                                                                                                                                                                   | 2026-10-06 |
| `sysctl`          | § 10       | `vm.overcommit_memory = 1`, so Redis can fork for its snapshots                                                                                                                                                                                                                                                                                                   | 2026-10-06 |
| `apt_clean`       | § 17       | apt cache cleaned every 7 days (Docker images: Dokploy's daily cleanup, not here)                                                                                                                                                                                                                                                                                 | 2026-10-06 |
| `origin_lockdown` | § 9, § 20  | the Cloudflare-only script + service; **3000 dropped for everyone**. Runs **before** `dokploy`: enabled everywhere, it starts with Docker's first start. Interface from Ansible's facts (`eth0` in production). **Its Cloudflare list is the one source**: a unit test keeps it equal to `src/lib/client-ip.ts`, and the `traefik` role checks Traefik against it |
| `dokploy`         | § 8        | installs Dokploy **once** with its own script, kept in the repo (hash-pinned, `dokploy_version` pinned). Never upgrades (Dokploy updates itself; the role says when to bump the pin). Every run checks `dokploy` + `dokploy-postgres` 1/1 and Traefik running; stops on a half-finished install                                                                   | 2026-10-06 |
| `disk_alert`      | § 18       | hourly disk check → Telegram; `alerts.env` written from `.env` with `no_log` and no diff (the token never shows)                                                                                                                                                                                                                                                  | 2026-10-06 |
| `traefik`         | § 13, § 21 | owns `dynamic/inflight.yml` (100 in flight). **Only checks** Dokploy's `traefik.yml`: both `trustedIPs` lists equal the Cloudflare ranges, and `inflight-cap@file` is on `websecure`. Never edits it                                                                                                                                                              | 2026-10-06 |

The web ports are closed in ufw, but ufw is **not** what keeps them
Cloudflare-only: Docker's published ports bypass ufw. That is
`origin_lockdown`'s job (§ 20, the `DOCKER-USER` chain).

**`traefik.yml` belongs to Dokploy**, which rewrites it when its web
server settings change. If a check fails with "traefik.yml lost a hand
edit", put back what the message names (SERVER.md § 13 / § 21), restart
Traefik, and check again.

**The disk alert needs two values in `.env`** (Bitwarden: Telegram alert
bot): `ALERTS_TELEGRAM_BOT_TOKEN` and `ALERTS_TELEGRAM_CHAT_ID`. Without
them, a production run stops at the `disk_alert` role rather than write
empty values; `--skip-tags alerts_secret` skips just that file. The lab
gets placeholders.

**Never** in Ansible: Dokploy's own settings (the owner account,
projects, databases, the compose app, its environment, backup schedules
live in Dokploy's database), the two hand edits in Traefik's
`traefik.yml` (Dokploy's file; the `traefik` role only checks them) and
the app's database role (needs the DB password). SERVER.md keeps those
as manual steps; its "Rebuilding from scratch" lists them in order.

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
own snapshots with `pnpm ansible:lab snapshot <name>`. **`with-dokploy`**
(saved 2026-10-06) is the lab after a full rebuild: Dokploy installed,
Traefik's hand edits in; `pnpm ansible:lab reset with-dokploy` skips the
~7-minute install. It runs ARM (Apple silicon) while production is x86:
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

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-06 | Slice A: `ops/ansible/`, roles `base`, `ssh`, `swap`, lab VM scripts, CI `ansible` (lint). Production check mode: **ok=13 changed=0** on the first run. Lab VM (Multipass, from `fresh`): full run, then a second run changed nothing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-10-06 | Slice B: roles `firewall`, `docker_config`, `sysctl`, `apt_clean`. Production check mode: **ok=25 changed=0**. Lab from `fresh`: changed=21, then the second run changed=0 (SSH still reachable with ufw on); 45 s including the reset                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-10-06 | Slice C: roles `origin_lockdown`, `disk_alert`, `traefik` (scripts moved from `ops/server/`; unit test path updated). Production check (alerts secret skipped until `.env` has it): **ok=37 changed=0**. Traefik guard tested on broken copies: a missing range and a missing middleware both fail. Lab: changed=29, then changed=0                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-10-06 | Slice D: role `dokploy` (installs once with the reviewed script kept in the repo, hash-pinned, `dokploy_version` v0.30.8; checks dokploy/postgres 1/1 + Traefik on every run; stops on a half install). `origin_lockdown` runs before it, drops 3000 for everyone, and reads its interface from `/etc/default/origin-lockdown`. **Rebuild rehearsal** on the lab from `fresh`: full run 7 min 23 s, stopped at the `traefik` guard as expected; 3000/80/443 closed from the Mac, open with the lockdown removed (control); tunnel to 3000 works; hand edits → `lab test` changed=0; snapshot `with-dokploy`. A cut-short install (Traefik missing) fails with its fix. Production check: **changed=4**, all the lockdown (script, `/etc/default`, unit, re-apply); `dokploy` all ok |
