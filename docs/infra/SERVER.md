# Production server

Status: ACTIVE · Owner: Evan · Last updated: 2026-09-27

The one VPS that runs echoandaura.com: what it is, how to get in, every
change made to it since the reinstall, and how to check or rebuild each
one. No secret is on this page: the values live in Bitwarden
(organization `echoandaura`, collection `echoandaura-infra`), under the
item names listed in [SECRETS.md](SECRETS.md).

How code reaches the server (images, deploys, rollback) is in
[../DEPLOY.md](../DEPLOY.md); why it is built this way is ADR-036 in
[../DECISIONS.md](../DECISIONS.md).

---

## The machine

| Item            | Value                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ |
| Provider / plan | BengalCloud, "BDIX Compute VPS 1"                                                                |
| Size            | 2 vCPU, 4 GB RAM (3.7 GiB usable), 25 GB NVMe, 2 TB traffic at 1 Gbps on BDIX                    |
| IPv4            | `160.25.226.166`                                                                                 |
| IPv6            | several on `eth0`, prefix `2001:df3:ad40:` (see `ip -6 addr`)                                    |
| OS              | Ubuntu 24.04 LTS (reinstalled 2026-09-27), kernel 6.8                                            |
| Hostname        | `echoandaura`                                                                                    |
| Time zone       | UTC, on purpose: the app converts to Asia/Dhaka itself                                           |
| Panels          | Securednoc (Virtualizor, port 4083): power, console, reinstall. BengalCloud client area: billing |
| Billing         | Monthly, 1,599 BDT. **An unpaid renewal suspends the site.** Next due 2026-10-26                 |
| Bought by       | Raj (the client)                                                                                 |

## Getting in

Only SSH keys work; passwords are refused for every user, root included.

**From a Mac or Linux laptop,** with an entry in `~/.ssh/config`:

```
Host echoandaura
  HostName 160.25.226.166
  User root
  IdentityFile ~/.ssh/echoandaura_vps
  IdentitiesOnly yes
  AddKeysToAgent yes
  UseKeychain yes        # macOS only: the passphrase comes from the Keychain
```

then `ssh echoandaura`. The key is ED25519 with a passphrase
(Bitwarden: `VPS SSH key (Evan)`). The server's host key fingerprints,
to check on a first connection:

- RSA: `SHA256:+eqrf3pSYNY4tczMACt4w+0AyyRI9SnW1Z1TMWuDQDo`
- ED25519: `SHA256:FGc3W4DJMuKfHfOWYNi7BtjTdLeHYDcY3upevEGWlqk` (added
  2026-09-27; its comment says `root@console`, the image's old hostname)

**Giving someone else access:** they make their own key
(`ssh-keygen -t ed25519 -f ~/.ssh/echoandaura_vps -C "<their-name>"`)
and send you the `.pub` line. Append it to `/root/.ssh/authorized_keys`,
one key per line, with their name as the comment. To remove someone,
delete their line. Never share a private key between people.

**Locked out** (lost key, broken SSH settings): Securednoc panel → the
VPS → **VNC / console**. It is a screen and keyboard attached to the
server, and it takes the root password (Bitwarden: `VPS root`), because
the SSH rules do not apply there. Fix `authorized_keys` or the file in
`/etc/ssh/sshd_config.d/`, then `systemctl restart ssh`.

---

## What was changed, and why

Everything below was done by hand, in this order, on 2026-09-27. Each
item says how to check it still holds. The whole check at once is in
[Verify](#verify).

### 1. Fresh Ubuntu 24.04

Reinstalled from the Securednoc panel (it shipped with 22.04; 24.04 is
supported until 2029). The reinstall also replaced the root password
that had been shared in a screenshot, and installed the SSH key above.
Then every update:

```sh
apt update
DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get -o Dpkg::Options::=--force-confold full-upgrade -y
reboot                      # the kernel was updated
apt autoremove --purge -y   # removes the old kernel
```

**What the provider's image brings.** After a reinstall the panel runs
its own "recipe" scripts as root; their logs land in `/root`
(`exec_recipe.log`, `recipe_-*.log`). An audit on 2026-09-27 found:

- The only thing the recipes do is start **`qemu-guest-agent`**, the
  helper the panel uses for clean shutdown, showing the IP and resetting
  the root password. Keep it: the provider controls the physical host
  anyway, so it adds no real risk, and without it the panel's emergency
  password reset stops working.
- Five of the six recipe logs predate this server (2025-08 to 2026-05):
  leftovers baked into the provider's image. Harmless, deleted. Treat the
  image as untrusted and check it after any reinstall.
- `/root/.ssh/authorized_keys` held exactly one key (ours), and `root`
  was the only account with a login shell.

**Check after any reinstall:**

```sh
awk '{print $1, $NF}' /root/.ssh/authorized_keys          # only keys you know
awk -F: '$7 ~ /(bash|sh|zsh)$/ {print $1}' /etc/passwd    # only root
```

### 2. SSH: keys only

**Why:** bots try passwords on every public server all day. With
passwords off, there is nothing to guess.

`/etc/ssh/sshd_config.d/00-hardening.conf`:

```
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
```

The name starts with `00-` on purpose. SSH keeps the **first** value it
reads for each setting, files load in alphabetical order, and the image's
`50-cloud-init.conf` sets `PasswordAuthentication yes`. A file named
`99-…` would silently lose.

Also ran `ssh-keygen -A`, which added the missing ED25519 and ECDSA host
keys (the image had RSA only).

**Check:** `sshd -T | grep -Ei '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin)'`
prints `no`, `no`, `without-password`. From a laptop,
`ssh -o PubkeyAuthentication=no root@160.25.226.166` must fail with
`Permission denied (publickey)`, without asking for a password.

**Changing SSH settings safely:** keep one session open, run
`sshd -t` (syntax check), then `systemctl restart ssh`, and test a new
login from a second window before closing the first.

### 3. Swap: 2 GB, used as a last resort

**Why:** with Dokploy, Postgres, Redis, web and worker sharing 4 GB, a
memory spike with no swap makes the kernel kill a process, possibly
Postgres. With swap it slows down for a moment instead. The image came
with 128 MB.

```sh
swapoff /swapfile && rm /swapfile
fallocate -l 2G /swapfile
chmod 600 /swapfile          # swap can hold anything that was in memory
mkswap /swapfile
swapon /swapfile
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
sysctl --system
```

`/etc/fstab` already had `/swapfile swap swap defaults 0 0` from the
image, so it switches on at boot.

**Check:** `swapon --show` shows `/swapfile 2G`; `sysctl vm.swappiness`
is `10`. If `free -h` shows swap in steady use, the server needs more
RAM, not more swap.

### 4. Automatic security updates

**Why:** security fixes (OpenSSL, the kernel, SSH) install every day
without anyone logging in. The image had them **switched off**: the
service was installed, but `/etc/apt/apt.conf.d/20auto-upgrades` said
`"0"`.

`/etc/apt/apt.conf.d/20auto-upgrades`:

```
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
```

Only Ubuntu's security channels are used (`noble-security` and ESM).
**It never reboots by itself.** Kernel fixes wait for a manual `reboot`
at a quiet time, never during a sale or on an event night. The login
message says `*** System restart required ***` when one is waiting.

**Check:** `apt-config dump | grep -E 'Periodic::(Update-Package-Lists|Unattended-Upgrade) '`
shows both `"1"`; `unattended-upgrade --dry-run -v` lists the allowed
origins without errors; `systemctl list-timers apt-daily-upgrade.timer`
shows the next run.

### 5. Hostname and clock

```sh
hostnamectl set-hostname echoandaura
sed -i 's/\bconsole\b/echoandaura/g' /etc/hosts     # the image's name was "console"
echo 'preserve_hostname: true' > /etc/cloud/cloud.cfg.d/99-keep-hostname.cfg
```

The last line stops cloud-init (the provider's first-boot tool) from
renaming the server at the next boot.

The clock was already synced by `systemd-timesyncd`. Certificates,
login sessions, the 24-hour holds and gate scan times all depend on it.

**Check:** `hostname` is `echoandaura`; `timedatectl` shows
`System clock synchronized: yes` and `NTP service: active`.

### 6. Firewall (ufw)

**Why:** only SSH, web traffic and (for now) the Dokploy dashboard may be
reached from the internet. Docker publishes container ports around ufw,
so ufw cannot close 80, 443 or 3000. It still matters: it blocks
everything Docker does not publish itself, including Docker Swarm's
management ports (2377, 7946, 4789), which listen on the public address
and are only meant for multi-server clusters.

Before this, the server had **no firewall at all** (empty iptables and
nftables, everything accepted), and the image did not include ufw.

```sh
apt install -y ufw          # from apt, not the snap it also suggests
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH           # FIRST: enabling ufw without it locks you out
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3000/tcp          # the Dokploy dashboard, until it has a domain
ufw enable
```

The 3000 rule was removed again once the dashboard had its domain
(section 9).

**Rule for everything that comes later:** never give a Dokploy database
an "external port". It would be published through Docker, around the
firewall, straight to the internet.

**Check:** `ufw status verbose` shows `deny (incoming)` and exactly three
rules: OpenSSH, 80/tcp, 443/tcp (each twice: IPv4 and IPv6).

### 7. Docker log limits

**Why:** Docker keeps every container's log forever by default. On a
25 GB disk, Traefik, Postgres and Dokploy would fill it slowly. Written
**before** Docker was installed, so every container gets it from the
start.

`/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
```

At most 30 MB of logs per container. Our own services set the same limit
in `docker-compose.prod.yml` as well.

**Check:** `docker info --format '{{.LoggingDriver}}'` is `json-file`;
`docker inspect -f '{{.HostConfig.LogConfig}}' <container>` shows
`max-size:10m`.

### 8. Dokploy

**Why:** a dashboard for deploys, logs, restarts, environment variables
and database backups, so running the site doesn't depend on SSH skills
(ADR-036).

Installed with Dokploy's official script, downloaded first and checked
against the copy that was reviewed:

```sh
cd /root
curl -fsSL https://dokploy.com/install.sh -o dokploy-install.sh
sha256sum dokploy-install.sh   # 92749e5fe1678d1a2dc1e5bad193a1e113fcdbee3cf24193fc14ab85765b6b8a on 2026-09-27
bash dokploy-install.sh
```

The script changes over time. On a rebuild, read the new one before
running it, and expect a different hash.

What it installed:

| Piece              | Version / detail                                     | Notes                                                                           |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| Docker             | 28.5.0, **held** (`apt-mark hold docker-ce …`)       | Automatic updates never change Docker under a running site. Update it by hand.  |
| Docker Swarm       | single node, advertised on the public IP             | Its ports (2377, 7946, 4789) are closed by ufw                                  |
| `dokploy-network`  | overlay network                                      | What `docker-compose.prod.yml` joins                                            |
| `dokploy`          | v0.30.7, a Swarm service, port 3000                  | The dashboard. Updates from its own UI                                          |
| `dokploy-postgres` | Postgres 16, a Swarm service                         | **Dokploy's own settings**, not the app's database. Password is a Docker secret |
| `dokploy-traefik`  | Traefik v3.6, a container, ports 80, 443 (TCP + UDP) | The front door: routes domains to containers, gets HTTPS certificates           |

**The owner account is whoever signs up first.** Port 3000 is public as
soon as the script finishes, so the account must be created right away.
It was created through an SSH tunnel, so the password never crossed the
internet unencrypted:

```sh
ssh -N -L 3000:localhost:3000 echoandaura    # on the laptop; then open http://localhost:3000
```

Credentials: Bitwarden `Dokploy admin` (password, 2FA backup codes).

**Check:** `docker service ls` shows `dokploy` and `dokploy-postgres` at
`1/1`; `docker ps` shows `dokploy-traefik` up.

### 9. The dashboard's address, and port 3000 closed

The dashboard lives at **https://deploy.echoandaura.com**, the only way
in. GitHub's Deploy workflow calls the same address (`DOKPLOY_URL`).

1. Cloudflare DNS: `A deploy → 160.25.226.166`, **DNS only** (grey
   cloud). It's for the owner and GitHub, not for visitors, and bot
   protection in front of it could block the deploy call. See
   [CLOUDFLARE.md](CLOUDFLARE.md).
2. Dokploy → Settings → Web Server → Server Domain:
   `deploy.echoandaura.com`, certificate **Let's Encrypt**, HTTPS on.
   Traefik fetched the certificate (first one valid until 2026-12-26)
   and renews it on its own about 30 days before expiry. `http://`
   redirects to `https://`.
3. Port 3000 closed, so the unencrypted direct door is gone:

   ```sh
   docker service update --publish-rm "published=3000,target=3000,mode=host" dokploy
   ufw delete allow 3000/tcp
   ```

   Traefik still reaches the dashboard over Docker's internal network.

**Emergency way in**, if the address breaks (a DNS mistake, a
certificate problem): re-open the port for a moment, use the tunnel,
fix, close it again.

```sh
# on the server
docker service update --publish-add "published=3000,target=3000,mode=host" dokploy
# on the laptop: ssh -N -L 3000:localhost:3000 echoandaura, then http://localhost:3000
# when fixed, on the server
docker service update --publish-rm "published=3000,target=3000,mode=host" dokploy
```

No ufw rule is needed for this: the tunnel arrives from inside the
server.

**Check** (from a laptop): `nc -z -G 5 160.25.226.166 3000` fails
(closed); `curl -sI https://deploy.echoandaura.com` answers `200` with a
Let's Encrypt certificate.

### 10. The app's Postgres and Redis

Created in Dokploy, project **`echoandaura`** (environment `production`),
as Dokploy database services. They are separate from Dokploy's own
Postgres 16, which holds only Dokploy's settings.

| Service  | Internal host (App Name)   | Image         | Memory limit | Data volume                     | Credentials (Bitwarden)                     |
| -------- | -------------------------- | ------------- | ------------ | ------------------------------- | ------------------------------------------- |
| Postgres | `echoandaura-db-ljctqy`    | `postgres:17` | 1 GiB        | `echoandaura-db-ljctqy-data`    | `Postgres (prod)`: password, `DATABASE_URL` |
| Redis    | `echoandaura-redis-t1myan` | `redis:7`     | 256 MiB      | `echoandaura-redis-t1myan-data` | `Redis (prod)`: password, `REDIS_URL`       |

- Database `echoandaura`, user `echoandaura` (the app's own user, not
  the `postgres` superuser). No extensions are needed.
- Dokploy appends a random suffix to each App Name. The host names above
  are the real ones, and they are what `DATABASE_URL` and `REDIS_URL`
  point at.
- Passwords are 32 letters and digits, with no symbols, because symbols
  like `@`, `/` or `#` break a connection URL.
- **No external port on either.** They are reachable only on
  `dokploy-network`, where web and worker run. An external port would be
  published around the firewall.
- Redis runs as `redis-server --requirepass <password>` (Dokploy's
  default), with Redis's own snapshotting to its volume. A crash can lose
  jobs queued in the last moments: an email that was about to be sent can
  be re-sent from the admin. AOF persistence (`--appendonly yes`) would
  close that gap; it needs a custom Run Command and is not set.
- The volumes survive restarts and redeploys, but not the loss of the
  server. Backups are a separate step.
- `vm.overcommit_memory = 1` in `/etc/sysctl.d/99-redis.conf` (host
  kernel setting, applies to every container). Redis saves its snapshot
  by forking a copy of itself; without this, the kernel can refuse that
  copy when memory looks tight, and the save fails. Redis warns about it
  at startup, and its documentation asks for it on every Redis host.
  **Check:** `sysctl vm.overcommit_memory` prints `1`.

**Check** (on the server): both show `1/1` in `docker service ls`, and
from Dokploy's network:

```sh
docker run --rm --network dokploy-network postgres:17 pg_isready -h echoandaura-db-ljctqy -U echoandaura   # accepting connections
docker run --rm --network dokploy-network redis:7 redis-cli -h echoandaura-redis-t1myan ping               # NOAUTH: reachable, and locked
docker service inspect echoandaura-db-ljctqy --format '{{json .Endpoint.Ports}}'                          # null: nothing published
```

### 11. The app (Dokploy Compose)

Dokploy project `echoandaura` → `production` → Compose app
**`echoandaura-app`** (folder on the server:
`/etc/dokploy/compose/echoandaura-app-5nuhfn`).

| Setting      | Value                                                                    | Why                                                                                                             |
| ------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Compose Type | Docker Compose (not Stack)                                               | `depends_on: service_completed_successfully` (migrate before web and worker) does not exist in Stack mode       |
| Provider     | Git: `https://github.com/Ashfak-Hossain/EchoAndAura.git`, branch `main`  | Public repo, so no GitHub connection needed. Dokploy reads only the compose file from it; images come from GHCR |
| Compose Path | `./docker-compose.prod.yml`                                              |                                                                                                                 |
| Autodeploy   | **off**                                                                  | A deploy must come only from GitHub's Deploy workflow, after the images are built and smoke-tested              |
| Compose ID   | in the app's URL (`…/compose/<id>`); Bitwarden `Dokploy deploy (GitHub)` | GitHub's `DOKPLOY_COMPOSE_ID` secret                                                                            |

**Environment tab** (values in Bitwarden; this is the list of names):

| Variable                                                               | From Bitwarden                                                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                         | `Postgres (prod)`                                                                           |
| `REDIS_URL`                                                            | `Redis (prod)`                                                                              |
| `SITE_URL`, `BETTER_AUTH_URL`                                          | `https://echoandaura.com` (not secret)                                                      |
| `BETTER_AUTH_SECRET`                                                   | `BETTER_AUTH_SECRET (prod)` (`openssl rand -base64 32`)                                     |
| `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`              | `Cloudflare R2 token`                                                                       |
| `R2_BUCKET`, `R2_PUBLIC_URL`                                           | `echoandaura-media`, `https://media.echoandaura.com`                                        |
| `AWS_SES_REGION`, `AWS_SES_ACCESS_KEY_ID`, `AWS_SES_SECRET_ACCESS_KEY` | `AWS worker key (SES)` (region `ap-south-1`)                                                |
| `EMAIL_FROM`, `EMAIL_REPLY_TO`                                         | `"echoandaura <tickets@echoandaura.com>"` (quoted: it has a space), `hello@echoandaura.com` |

Left out on purpose: the bKash number, phone and Facebook fallbacks (the
live values are set at `/admin/settings`), and `IMAGE_TAG` (defaults to
`main`; set only to roll back, see [../DEPLOY.md](../DEPLOY.md)).
`docker-compose.prod.yml` decides which service gets which variable; the
SES keys reach the worker only.

Dokploy writes these into a `.env` file in the app's folder at deploy
time, not when they are saved.

**Check** (in the Environment tab): searching for `<` finds only the one
inside `EMAIL_FROM`; anything else is a placeholder never replaced.

### 12. First deploy (2026-09-27)

PR #1 merged into `main` as `bf87d7e` → CI green → Deploy workflow →
Dokploy. About 10½ minutes from merge to running:

| Stage                                   | Time        |
| --------------------------------------- | ----------- |
| CI on `main`                            | 2½ min      |
| Build web (first build, empty cache)    | 2 min 50 s  |
| Build worker (reuses web's build stage) | 2 min 13 s  |
| Smoke test                              | 7 s         |
| Push to GHCR                            | 42 s        |
| Dokploy: pull images, `migrate`, start  | about 2 min |

Result: `migrate` applied every migration to the empty database in
0.6 s and exited 0 (15 tables); then `web` started (health check
`healthy`, `/api/health` `{"ok":true,"database":true,"queue":true}`)
and `worker` started with hold expiry scheduled every minute. Idle memory:
web 126 MB, worker 122 MB. Disk after the first pull: 13 of 25 GB.

The GHCR images are **public** (anonymous pull works), so the server
needs no registry key.

The site is **not public yet**: no DNS for `echoandaura.com` and no
domain on the web service.

**Check** (on the server):

```sh
docker ps -a --filter name=echoandaura-app --format '{{.Names}}\t{{.Status}}'   # migrate Exited (0); web Up (healthy); worker Up
docker logs echoandaura-app-5nuhfn-migrate-1                                     # Migrations up to date
docker exec echoandaura-app-5nuhfn-web-1 node -e "fetch('http://127.0.0.1:3000/api/health').then(async r=>console.log(r.status, await r.text()))"
```

### 13. Going public: Cloudflare in front of the site

**Cloudflare zone settings** (checked 2026-09-28, both already correct):

- SSL/TLS encryption mode **Full (strict)**: Cloudflare connects to the
  server over HTTPS and checks its certificate. **Never "Flexible"**:
  Cloudflare would then use plain HTTP, Traefik would redirect to HTTPS,
  and browsers would get "too many redirects".
- **Always Use HTTPS: off.** Let's Encrypt proves domain control by
  fetching a file over plain HTTP; if Cloudflare upgraded that request,
  it would reach Traefik before the certificate exists and issuing would
  fail. Traefik does the HTTP → HTTPS redirect itself, after the challenge.
- HSTS: off for now (a months-long browser commitment; Phase 7).

**Traefik trusts Cloudflare's forwarded headers.** The app rate-limits by
the first address in `X-Forwarded-For` (`src/lib/request-ip.ts`). By
default Traefik trusts nobody's forwarded headers: it would replace
Cloudflare's "the visitor is X" with Cloudflare's own address, and every
buyer would share one rate-limit bucket (the whole country throttled
together during a sale). Each entrypoint in
`/etc/dokploy/traefik/traefik.yml` now has:

```yaml
forwardedHeaders:
  trustedIPs: [Cloudflare's IPv4 and IPv6 ranges from cloudflare.com/ips, fetched 2026-09-28]
```

A request from those ranges keeps its `X-Forwarded-For`; a request from
anywhere else (someone skipping Cloudflare and hitting the IP directly)
has it replaced, so nobody can fake their address. Added with a script
that refused to touch an unexpected file, after a dated backup
(`traefik.yml.bak-2026-09-28`), then `docker restart dokploy-traefik`
(Traefik reads this file only at start).

- **Undo:** `cp /etc/dokploy/traefik/traefik.yml.bak-2026-09-28 /etc/dokploy/traefik/traefik.yml && docker restart dokploy-traefik`
- **Watch for:** Dokploy rewrites `traefik.yml` for some settings changes
  (e.g. the dashboard's own domain or Let's Encrypt email). After any
  change under Dokploy → Settings → Web Server, check the rule is still
  there: `grep -c trustedIPs /etc/dokploy/traefik/traefik.yml` must print
  `2`.
- **Cloudflare's ranges change rarely**, with notice. Compare with
  https://www.cloudflare.com/ips/ once a year (with the API key renewal)
  or when Cloudflare announces a change. The **same list is in the code**
  (`CLOUDFLARE_RANGES` in `src/lib/client-ip.ts`): change both together.

**Proved on 2026-09-28** with a throwaway `traefik/whoami` container on
`echoandaura.com/__whoami`, which echoes the headers a request reaches
the app with (removed right after):

| Request                         | `X-Forwarded-For` at the app                  |
| ------------------------------- | --------------------------------------------- |
| Normal, through Cloudflare      | `<visitor>, <Cloudflare edge>`                |
| Through Cloudflare, with a fake | `1.2.3.4, <visitor>, <Cloudflare edge>`       |
| Skipping Cloudflare, with fakes | `<sender>` only (Traefik replaced the header) |

So Traefik does its part. The app must then read the list **from the
right**, skipping Cloudflare, because the left end is the visitor's own
text: [ADR-037](../DECISIONS.md). `CF-Connecting-IP` passed a fake straight
through when Cloudflare was skipped, so it is not trusted.

To repeat the test (e.g. after changing Traefik or the ranges):

```sh
docker run -d --rm --name whoami-test --network dokploy-network \
  --label traefik.enable=true \
  --label 'traefik.http.routers.whoami-test.rule=Host(`echoandaura.com`) && PathPrefix(`/__whoami`)' \
  --label traefik.http.routers.whoami-test.entrypoints=websecure \
  --label traefik.http.routers.whoami-test.tls.certresolver=letsencrypt \
  --label traefik.http.routers.whoami-test.priority=1000 \
  --label traefik.http.services.whoami-test.loadbalancer.server.port=80 \
  traefik/whoami:latest
# from a laptop: curl -s https://echoandaura.com/__whoami -H 'X-Forwarded-For: 1.2.3.4' | grep -i forwarded
docker stop whoami-test    # it echoes headers publicly: never leave it running
```

Also in `traefik.yml`: `api: insecure: true` is Traefik's own dashboard
on port 8080 _inside_ the container. That port is not published, so it is
reachable only from Docker's internal network. Leave it.

### 14. Admin accounts and the first real email (2026-09-28)

Admins are created in the worker container (DEPLOY.md § Creating an admin
account). The password is typed at a hidden prompt, so it never lands in
the shell history:

```sh
read -rp 'Email: ' ADMIN_EMAIL
read -rsp 'Password (hidden): ' ADMIN_PW; echo
read -rp 'Name: ' ADMIN_NAME
docker exec echoandaura-app-5nuhfn-worker-1 \
  node dist/ops/create-admin.mjs "$ADMIN_EMAIL" "$ADMIN_PW" "$ADMIN_NAME"
unset ADMIN_PW
```

| Admin | Email                                | Bitwarden                              | Created    |
| ----- | ------------------------------------ | -------------------------------------- | ---------- |
| Evan  | the developer's Gmail (SES-verified) | `Admin login (echoandaura app) — Evan` | 2026-09-28 |

**First production email: a password reset to Evan, 2026-09-28.** The
first attempt failed: SES refused every send with
`IncompleteSignatureException: Invalid key=value pair (missing
equal-sign) in Authorization header`. Cause: the two SES lines in
Dokploy's Environment still held the template placeholders (`<access key
id>`, `<secret access key>`). Nothing checks their shape, so the worker
started fine and only the first email failed. Fixed by pasting the real
keys from Bitwarden (`AWS worker key (SES)`) and redeploying; the retry
arrived (SES message id `010901a0e671…`), and the reset worked.

**Check the environment's shape without printing any value** (every line
must say `ok`; `EMAIL_FROM` legitimately contains `< >`):

```sh
docker exec echoandaura-app-5nuhfn-worker-1 node -e '
for (const n of ["DATABASE_URL","REDIS_URL","BETTER_AUTH_SECRET","R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY","AWS_SES_ACCESS_KEY_ID","AWS_SES_SECRET_ACCESS_KEY"]) {
  const v = process.env[n] ?? "";
  console.log((/<[^>]*>|Bitwarden/.test(v) ? "PLACEHOLDER " : "ok          ") + n + " (length " + v.length + ")");
}'
```

Expected lengths: SES access key id 20 (starts `AKIA`), SES secret 40,
R2 key id 32, R2 secret 64, `BETTER_AUTH_SECRET` 44.

**The first ticket email failed too** (same day): `ENOENT … /app/src/server/pdf/fonts/NotoSans-Regular.ttf`.
The ticket PDF reads its fonts from `<cwd>/src/server/pdf/fonts`; the web
image gets them through Next's file tracing, but the worker image did
not copy them. Fixed in the `Dockerfile`, and **the worker now checks at
boot**: it refuses to start if a font is missing or if an SES key does
not have a key's shape (20 characters `AKIA…`/`ASIA…`, 40 characters),
with a message that names the problem and never the value. The deploy's
smoke test ("the worker stays up") therefore stops either mistake before
production, and a bad edit of the Environment in Dokploy shows at once in
the worker log. After a failed ticket email, the admin re-sends it from
the order page.

**An admin address gets no buyer sign-in link, by design.** The buyer
"email me a sign-in link" form skips any address that belongs to an
admin (the web log says `magic link requested for an admin email — not
sent`), while still answering "check your inbox" so admin addresses
cannot be discovered. Otherwise that inbox alone would open the admin
console, without the password. Test the buyer side with a non-admin
address (in the SES sandbox, one that is verified, or any
`@echoandaura.com` address).

**Reading an email failure:** the worker logs every attempt of a job
(`jobId`, `name`, `attempt`, the provider's error). `auth.account` jobs
retry 3 times; after that the request must be made again.

```sh
docker logs --since 1h echoandaura-app-5nuhfn-worker-1 2>&1 | grep -E 'email sent|"level":50'
```

### 15. Test data removed before launch (2026-09-28)

Production had held only test data since the first deploy: the event
`test-delete-me` (draft), one ticket type, one order with its ticket and
12 audit rows, and one promo code. The app cannot delete an event, by
design (ADR-008, and `order_events` is append-only), so the user emptied
the event and order tables by hand. This was a one-off, deliberate
exception to "never run destructive SQL against production", made while
nothing real existed. **Once real orders exist, this must not be
repeated.**

1. Backup: `pg_dump -Fc` to `/root/before-wipe-2026-09-28.dump`
   (51,602 bytes, 16 tables of data), copied to the developer's Mac with
   `scp`. Both copies were deleted the same day: they held only discarded
   test data, plus the admin's password hash.
2. One transaction, with no `CASCADE`, so a missed reference would have
   rolled everything back:

   ```sql
   TRUNCATE door_scans, door_passes, tickets, order_events, orders,
            promo_code_ticket_types, promo_codes, ticket_types, events;
   ```

3. Kept: `users`, `accounts` (Evan's admin), `sessions`, `verifications`
   and `settings` (the organizer settings). Counts after: events,
   ticket types, orders, audit rows, tickets and promo codes all 0;
   users 1, accounts 1, settings 1. The site still answers 200.
4. The TEST cover image in R2 `echoandaura-media` became an orphan
   (`events/aaf723b2-c22d-4710-bdcf-c222a4f5ee9e/cover-BlOIeCiND95K.jpg`).
   It was deleted in the Cloudflare dashboard the same day, and
   `media.echoandaura.com` now answers 404 for it.

The demo for Raj runs on the seeded local database (`pnpm db:seed
--reset`, `MAILER=log`), never on production.

### 16. Nightly Postgres backups to R2 (2026-09-28)

Dokploy's built-in database backups (ADR-036), written to the private R2
bucket `echoandaura-backups` ([CLOUDFLARE.md](CLOUDFLARE.md)). Only the
app's Postgres is backed up. Redis holds queues and rate-limit counters,
and an email lost with it can be re-sent from the admin.

| Setting                                  | Value                                                                                                                                                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Destination (Settings → S3 Destinations) | `r2-backups`: Cloudflare, bucket `echoandaura-backups`, region `auto`, endpoint `https://<account-id>.r2.cloudflarestorage.com` (no bucket in the URL). Key: Bitwarden `Cloudflare R2 backups token` |
| Backup (the Postgres service → Backups)  | database `echoandaura`, prefix `postgres/`, enabled                                                                                                                                                  |
| Schedule                                 | `0 21 * * *`: the server's clock is UTC, so this is **03:00 Dhaka**, when nobody is buying                                                                                                           |
| Retention                                | the latest **14**: two weeks to notice a bad change before its last good copy rotates out                                                                                                            |
| Format                                   | `pg_dump -Fc --no-acl --no-owner … \| gzip` (Dokploy's command), about 10 kB while the database holds no events                                                                                      |
| Object name                              | `echoandaura-db-ljctqy/postgres/<UTC timestamp>.sql.gz`: Dokploy puts the service name in front of the prefix                                                                                        |
| Failure alerts                           | **none yet**; they come in D3, with the uptime alerts. Until then, check that R2 has a file from last night                                                                                          |

The backups hold every order and the buyers' names, emails and phone
numbers. The bucket has no public name, and its key can reach this
bucket only.

**Restore test (2026-09-28), off the server:**

1. The first manual backup was downloaded from the R2 dashboard to the
   developer's Mac.
2. It was restored into a throwaway `postgres:17` container, not the dev
   database.
3. The result matched production: 15 tables, 24 migrations with the same
   latest one, the same row counts, and the same md5 over every
   `settings`, `users` and `accounts` row.
4. The container and the downloaded file were deleted afterwards.

Repeat the test after any change to the backup settings, and before
the first event.

**Restore into an empty database** (rebuilding the server, "Rebuilding
from scratch" step 5). Before the app starts:

1. In the R2 dashboard, download the newest file from `echoandaura-backups`.
2. Copy it to the server with `scp <file> echoandaura:`.
3. On the server:

```sh
C=$(docker ps -q -f name=<postgres App Name> | head -1)
gunzip -c ~/<file>.sql.gz | docker exec -i $C pg_restore -U echoandaura -d echoandaura --no-owner --exit-on-error
docker exec $C psql -U echoandaura -d echoandaura -c 'select count(*) from drizzle.__drizzle_migrations'
rm ~/<file>.sql.gz
```

It prints nothing when it works. On a database that already has tables,
it stops at the first one that exists. That is on purpose: this command
never overwrites anything.

Restoring over live data is a different case, for example undoing a
bad bulk edit: stop web and worker, restore into a new database, check
it, then switch. That belongs in the RUNBOOK (D3). Dokploy's own
**Restore** button has not been tried, and its documentation does not
say whether it overwrites the target database. Do not use it on
production until it has been tested on a scratch database.

---

## Verify

The whole server in one read-only run (from a laptop):

```sh
ssh echoandaura '
  . /etc/os-release; echo "OS: $PRETTY_NAME, kernel $(uname -r)"
  echo "host: $(hostname)"
  sshd -T | grep -Ei "^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin)"
  swapon --show --noheadings; sysctl vm.swappiness
  apt-config dump | grep -E "Periodic::(Update-Package-Lists|Unattended-Upgrade) "
  timedatectl | grep -E "synchronized|NTP"
  ufw status | head -1
  docker version --format "Docker {{.Server.Version}}"
  docker service ls --format "{{.Name}} {{.Replicas}} {{.Image}}"
  docker ps --format "{{.Names}}: {{.Status}}"
  df -h / | tail -1
  [ -f /var/run/reboot-required ] && echo "REBOOT PENDING" || echo "no reboot pending"
'
# From outside: only 22, 80 and 443 may answer.
for p in 22 80 443 2377 3000 5432 6379 7946; do
  nc -z -G 3 160.25.226.166 $p 2>/dev/null && echo "$p open" || echo "$p closed"
done
curl -sS -o /dev/null -w 'dashboard: %{http_code}\n' https://deploy.echoandaura.com/
```

`nc -G` is the macOS spelling; on Linux use `nc -z -w 3`.

## Rebuilding from scratch

If the server is lost or has to be replaced (a new plan, a new provider),
nothing on it is unique: the app comes from GHCR images, the data from
the Postgres backup in R2, the settings from Bitwarden. In order:

1. A new VPS with Ubuntu 24.04 and your SSH public key (from the
   provider's panel). Put the root password in Bitwarden (`VPS root`).
2. Sections 1 to 7 above, in order. The firewall and `daemon.json` come
   **before** Dokploy.
3. Section 8: Dokploy, then create the owner account through the tunnel
   immediately.
4. Section 9: point `deploy` at the new IP in Cloudflare (and update the
   IP in this file, CLOUDFLARE.md and `scripts/infra-check.ts`), set the
   Server Domain, close port 3000.
5. Section 10: the project, Postgres and Redis. **Restore the latest
   Postgres backup** into the new database before the app starts
   (section 16, "Restore into an empty database"), then set up section 16's
   destination and nightly backup again. The new
   App Names get new suffixes: update this file and the URLs in
   Bitwarden.
6. Section 11: the Compose app and its Environment, from Bitwarden. Put
   its new compose ID in GitHub's `DOKPLOY_COMPOSE_ID` secret.
7. Deploy: GitHub → Actions → Deploy → Run workflow (branch `main`).
   Check as in section 12.
8. The steps after this point are added here as they are done.

## History

| Date       | Change                                                                                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-26 | VPS bought (Ubuntu 22.04 image)                                                                                                                                                           |
| 2026-09-27 | Reinstalled with Ubuntu 24.04; updates; SSH keys only; 2 GB swap; automatic security updates on; hostname `echoandaura`                                                                   |
| 2026-09-27 | ufw installed and enabled (22, 80, 443, 3000); Docker log limits in `/etc/docker/daemon.json`, before Docker                                                                              |
| 2026-09-27 | Dokploy v0.30.7 installed (Docker 28.5.0, Traefik v3.6, Swarm). Owner account created via SSH tunnel; nobody had claimed it in the ~2 h port 3000 was open                                |
| 2026-09-27 | Dashboard at https://deploy.echoandaura.com (DNS only, Let's Encrypt). Port 3000 closed; outside scan: only 22, 80, 443 answer                                                            |
| 2026-09-27 | Audit of the provider's image: recipes only start qemu-guest-agent; stale recipe logs from other machines removed; one SSH key, root the only shell                                       |
| 2026-09-27 | App Postgres 17 (1 GiB) and Redis 7 (256 MiB) in Dokploy project `echoandaura`; no external ports; reachable on `dokploy-network`, closed from outside                                    |
| 2026-09-27 | Compose app `echoandaura-app` (Git source, `main`, Autodeploy off) with its Environment; not deployed yet. Dokploy 2FA on                                                                 |
| 2026-09-27 | `vm.overcommit_memory = 1` for Redis snapshots (`/etc/sysctl.d/99-redis.conf`)                                                                                                            |
| 2026-09-27 | **First deploy**: PR #1 (`bf87d7e`) → CI → Deploy → Dokploy in ~10½ min; 15 tables; web healthy, worker running. Not public yet                                                           |
| 2026-09-28 | Cloudflare checked (Full strict, Always Use HTTPS off); Traefik entrypoints trust Cloudflare's ranges for `X-Forwarded-For`                                                               |
| 2026-09-28 | **Site public**: `echoandaura.com` + `www` (proxied, www → root 301), web domain in Dokploy (Let's Encrypt). whoami test: Traefik trust works; app must read XFF from the right (ADR-037) |
| 2026-09-28 | PR #3 deployed (admin self-service, limiter fix). Evan's admin created. SES keys were template placeholders in Dokploy → fixed; first production email sent and received                  |
| 2026-09-28 | Ticket email failed (worker image lacked the PDF fonts). Fix: fonts copied; worker refuses to boot without fonts or with malformed SES keys                                               |
| 2026-09-28 | Test data removed (§ 15): backup first, then event/order tables emptied in one transaction; admin account and settings kept; backups and the orphaned R2 cover deleted                    |
| 2026-09-28 | Nightly Postgres backups (§ 16): R2 destination `r2-backups`, `0 21 * * *` UTC (03:00 Dhaka), keep 14. First backup restored on the Mac and matched production exactly                    |
