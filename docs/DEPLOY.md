# Deploying

Status: ACTIVE · Last updated: 2026-10-08 · Decisions:
[ADR-036](decisions/036-deployment-dokploy.md),
[ADR-066](decisions/066-confirmed-app-deployments.md),
[ADR-067](decisions/067-confirmed-baseline-deploy-filtering.md)

**D3B rollout:** D3B1's first live run confirmed web and both worker queues at
merge `89f0ac2`. D3B2's first automatic skip passed on 2026-10-08 after
[PR #73](https://github.com/Ashfak-Hossain/EchoAndAura/pull/73) merged as
`7b5bfcc`: [Deploy run 37752597485](https://github.com/Ashfak-Hossain/EchoAndAura/actions/runs/37752597485)
completed successfully, with selection successful and `images` skipped.
Fresh public probes confirmed healthy web and worker at `89f0ac2`, including
after the separate docs publication. The non-runtime filter is active.

How code gets from a laptop to echoandaura.com, and how to undo it. The
server itself (Dokploy, backups, disk, monitoring) is recorded in
[infra/SERVER.md](infra/SERVER.md). What to do when something breaks is in
[RUNBOOK.md](RUNBOOK.md).

---

## The short version

Optional error tracking has separate public build settings and a private BuildKit
upload credential. See [ERROR-TRACKING.md](ERROR-TRACKING.md) before enabling it.
An empty DSN keeps reporting off; source-map upload failure stops the image build.

```
branch → PR → CI green → merge to main → compare with running revision
                                        ├─ runtime change → images → deploy
                                        └─ known non-runtime only → no app restart
```

- **`main` is the production source.** Application-affecting merges deploy after
  green CI; known non-runtime-only merges keep the confirmed images running.
  Work on a branch; merge only when CI is green.
- **Never edit code on the server**, and never change the production
  database by hand. Schema changes are Drizzle migrations
  (`pnpm db:generate`), committed with the code that needs them; they run
  on their own at deploy.
- **Dev is your laptop** (`pnpm dev`, local Postgres/Redis/MinIO, `.env`).
  There is no staging server: the disk is too small for two copies, and the
  CI smoke test boots the exact production images first.

## What happens on a merge to main

1. **CI** (`.github/workflows/ci.yml`): `pnpm verify`, then the Postgres
   integration tests (the inventory race included). Red stops everything.
2. **Deploy** (`.github/workflows/deploy.yml`), only after a green CI run
   of a push to `main`:
   1. reads the exact healthy production revision and compares every changed
      path from that commit to current `main`;
   2. stops successfully when every change is explicitly non-runtime, leaving
      the currently confirmed application images running;
   3. otherwise builds two images from the `Dockerfile` on GitHub's machines —
      `echoandaura-web` (the site) and `echoandaura-worker` (emails, hold
      expiry, and the migrate/admin scripts);
   4. **scans them** for known vulnerabilities and stops on any critical one
      that has a fix (ADR-069; [below](#when-the-image-scan-fails));
   5. **smoke-tests them**: every migration on an empty database, the site
      answering `/api/health` and `/`, the worker staying up, and
      `/api/deployment` confirming the full revision of both images;
   6. pushes them to GHCR (GitHub's container registry) tagged `main` and
      `sha-<commit>`, takes each image's digest from the push and checks
      that the tag still resolves to it on GHCR (it fails if not). A separate
      `attest` job then signs, for each digest, where it was built and what
      is in it (ADR-075; [below](#checking-where-an-image-came-from));
   7. calls Dokploy, which pulls the new images and runs
      `docker-compose.prod.yml`:
      **migrate** first; **web** and **worker** start only if it succeeded;
   8. waits up to five minutes for the exact healthy web/worker revision to
      answer at `/api/deployment`. A timeout fails the workflow rather than
      reporting that a deployment request was a successful rollout.
3. The site is down for a few seconds while `web` restarts (until its
   health check passes; the image checks every 2 s while booting). Deploy outside
   the busy hours of a sale, and never on event night unless something is
   broken.

A failed migration leaves the old version running: nothing new starts.

## When the image scan fails

The Deploy run stops at **Scan images**, before anything is pushed or deployed;
production keeps running the previous images. The log lists each finding:
the package, the installed and fixed versions, and where in the image it sits.

1. **Update the package** to the fixed version: a Dependabot or hand bump of
   the npm dependency, a pnpm override for a transitive one, or a newer
   Node tag and digest in both Dockerfiles for the base image (ADR-081).
   Dependabot groups these references into one PR. Merge it; the next deploy
   scans again.
2. **If the fix cannot ship yet**, and the finding is in code the app never
   runs, add it to [.trivyignore.yaml](../.trivyignore.yaml) in a PR: the CVE
   id, a `statement` saying why it is safe for now, and an `expired_at` no more
   than 30 days out. When it expires the deploy fails again, so the fix is not
   forgotten.

To check an image before merging, scan it locally with the same pinned
scanner (`TRIVY_IMAGE` in deploy.yml):

```bash
docker run --rm "$TRIVY_IMAGE" image --scanners vuln --ignore-unfixed \
  --severity CRITICAL,HIGH ghcr.io/ashfak-hossain/echoandaura-worker:sha-<commit>
```

## Requested versus confirmed (D3B1)

The two images contain a build-owned full Git commit in
`deployment-revision.json`. GitHub supplies `SOURCE_REVISION` from the checked-out
commit; **do not add it to Dokploy's Environment tab**. It is not a new secret.
If building images locally, supply `--build-arg SOURCE_REVISION=<full-commit>`
to both targets as well as the existing `R2_PUBLIC_URL` build argument.

The public `/api/deployment` response contains only the public commit and a
readiness boolean. `200` with `ready: true` means dependencies are healthy and
both worker queues have fresh evidence matching the web image. `503` means the
revision is unknown, mixed, unhealthy, stale or unavailable. Existing health
and liveness responses are unchanged; local dev without an image manifest is
deliberately unconfirmed. This evidence covers the present single-web and
single-worker topology, not every instance in a scaled fleet.

After requesting Dokploy, GitHub confirms the **expected full commit**, not
just any ready response. That read-only step has no deployment credentials,
refuses redirects and cached/unexpected data, and never logs response bodies.
If it times out, check the Dokploy deployment, migration result, container
health, queue heartbeat and any `IMAGE_TAG` rollback pin privately. Do not reset
a pin, repeat a deploy, rotate a key or change the database merely to make the
check green. It cannot tell whether a timeout was an actual failure or a slow
rollout; verify before deciding what to do next.

The CI smoke test checks both image revisions before pushing. The first D3B1
production workflow and live revision were confirmed at `89f0ac2`. No Terraform
apply or additional environment secret is required.

## When application deployment is skipped (D3B2)

The selector compares from what is **actually healthy in production**, not from
the previous commit or PR. That matters when several docs merges follow the last
application deployment: the next application change still sees the complete
range and deploys it.

The allowlist is intentionally narrow: `docs/`, docs-site sources except its
package manifest, tests, GitHub/agent instructions, Terraform, Ansible and root
Markdown files. Any unknown path, application source, migration, dependency,
Docker input, relay or other operations file selects a full deployment. The
selection job has no package-write or deployment credentials.

If the public evidence is unavailable, current `main` deploys as it did before
the filter. A manual run from `main` also always deploys. A stale workflow is
skipped; history that would move production backwards or cannot connect the
running revision to the candidate fails visibly. The selector never clears a
rollback pin.

After a non-runtime-only merge, `main` is newer than `/api/deployment` on
purpose. The workflow summary records the decision and the confirmed baseline.
The separately tested docs publisher still publishes developer-site changes.

## Rolling back

The app, in Dokploy → the compose app → **Environment**:

1. Find the last good application deployment: GitHub → Actions → Deploy →
   the last run before the bad one whose `images` job and final revision
   confirmation succeeded. Its summary says `Deploy of sha-abc1234`.
   A successful selection-only skip creates no new image; do not use that
   run's commit as a rollback tag.
2. Check that the tag still names what the Deploy workflow built, for both
   images ([below](#checking-where-an-image-came-from)). For a version,
   the digests must also match the ones in its GitHub Release. Images built
   before ADR-075, v1.0.0's included, were never signed and fail this
   check; rolling back to one of them trusts the tag alone.
3. Set `IMAGE_TAG=sha-abc1234` and click **Deploy**. Dokploy pulls that
   exact version. A released version works too: `IMAGE_TAG=v1.1.0`
   (DEVELOPMENT.md → Releases).
4. Fix forward on a branch as usual. Once the fix is on `main`, set
   `IMAGE_TAG` back to `main` (or delete it) and deploy.

**Migrations are not rolled back.** An old version runs against the newer
schema, so migrations must stay backward compatible: add columns and
tables freely; remove or rename one only in a later release, after the
code that used it is gone. If a migration itself damaged data, restore
from backup ([RUNBOOK.md](RUNBOOK.md#restore-from-backup)) — never hand-edit production.

## Running a script on the server

In Dokploy → the compose app → the **worker** container → **Terminal**:

```sh
node dist/ops/create-admin.mjs raj@example.com 'a-password-of-12-or-more' 'Raj'
node dist/ops/promote-admin.mjs someone@example.com
node dist/ops/admin-reset-2fa.mjs raj@example.com   # lost phone + backup codes (ADR-049)
node dist/ops/migrate.mjs      # runs on every deploy anyway
```

### Creating an admin account and handing it over

1. Generate the password in Bitwarden (20 characters or more; the
   minimum is 12) and create the account with `create-admin` as above.
2. Share the Bitwarden item with the person. Never send a password by
   chat, SMS or email.
3. They sign in at `/admin/login` and change it at **Your account**
   (`/admin/account`) whenever they like. That also signs out every other
   device.
4. At that first sign-in they are sent to set up two-factor (ADR-049):
   an authenticator app on their phone (Google Authenticator, Microsoft
   Authenticator, 1Password, …) scans a QR code, and they save the 10
   backup codes it shows, in Bitwarden or on paper, not on the phone.
   From then on every sign-in asks for a code. Lost phone, or a new
   one (it can only be added after a reset):
   [RUNBOOK.md](RUNBOOK.md#an-admin-lost-their-phone).

A forgotten password is reset by the person themselves: **Forgot
password?** on the sign-in page emails a link, valid for an hour. An
admin can also move the account to a new email at **Your account**: the
new address must confirm, and the old one gets a notice (ADR-038). While
SES is in the sandbox, these emails reach only verified addresses
(docs/infra/AWS.md).

## One-time setup (Slice D2)

In GitHub → the repo → Settings → Secrets and variables → Actions:

| Kind     | Name                 | Value                                                                          |
| -------- | -------------------- | ------------------------------------------------------------------------------ |
| Variable | `R2_PUBLIC_URL`      | `https://media.echoandaura.com`: baked into the build (ADR-033)                |
| Secret   | `DOKPLOY_URL`        | `https://deploy.echoandaura.com`                                               |
| Secret   | `DOKPLOY_API_KEY`    | Dokploy → Settings → Profile → API / CLI (Bitwarden `Dokploy deploy (GitHub)`) |
| Secret   | `DOKPLOY_COMPOSE_ID` | The compose app's id (in its URL in Dokploy)                                   |

Without `R2_PUBLIC_URL` the Deploy workflow does nothing; without the three
Dokploy secrets it builds and pushes images but does not deploy. So `main`
can be merged before the server exists. All four were set on 2026-09-27.

**`main` is protected** by the ruleset "main is production" (Settings →
Rules → Rulesets), created 2026-09-27: no deleting it, no force-pushing,
changes only through a pull request (no approval needed: one maintainer),
and CI's `verify` check must pass before the merge button works. There is
no bypass, for admins either.

**Release tags are protected** by two more rulesets (ADR-074), created
2026-10-14: "release tags: owner creates" lets only the repository admin
create a `v*` tag, and "release tags never move" lets nobody, admins
included, move or delete one. A wrong tag is fixed with the next patch
version, not by moving it. All three rulesets are files in
`ops/github/rulesets/`; `pnpm rulesets:check` (read-only, needs `gh`) fails
if GitHub differs from them. To change one, edit its file, then
`gh api -X PUT repos/Ashfak-Hossain/EchoAndAura/rulesets/<id> --input <file>`
and run the check.

The two packages on GHCR are **public** (checked 2026-09-27: anonymous
pull works), so the server pulls them with no key. That is safe: the
repo is public too, and no secret is in the images (the build fails if a
placeholder leaks into the output). If they ever become private, the
server needs a read-only key: GitHub → Settings → Developer settings →
Personal access tokens → Tokens (classic), **only** `read:packages`, one
year; add it in Dokploy → Settings → Registry (`ghcr.io`, your GitHub
username, the token as password), or once over SSH with
`docker login ghcr.io -u <github-username>`. Keep it in Bitwarden.

The runtime environment (database, Redis, R2, SES, auth secret) is set in
Dokploy, never in GitHub or the repo: `docker-compose.prod.yml` lists every
variable each service needs, and [ENVIRONMENT.md](ENVIRONMENT.md) says what
each one is. The values live in Bitwarden.

### Bot check keys (ADR-048)

**Before merging the Turnstile change**, both `TURNSTILE_SITE_KEY` and
`TURNSTILE_SECRET_KEY` must be in Dokploy → the compose app →
Environment (the widget: [infra/CLOUDFLARE.md § Turnstile](infra/CLOUDFLARE.md#turnstile)).
Without them `docker-compose.prod.yml` refuses to start, so the deploy
fails and the old version keeps running. CI's smoke test does not catch
it: it runs the images without the compose file and opens only `/` and
`/api/health`. A test key in Dokploy gets past the compose file but makes
registration, Find my order, sign-in, admin login and forgot password
throw on every visit.

**After that deploy**, and after any change to either key: open
**Find my order**, enter a made-up reference in the right shape
(`EA-7K3M9Q`) and any valid mobile number, and send it. It must say
"No order matches that reference and phone number". The bot message ("We couldn't confirm
you're not a bot") means the check failed: see
[RUNBOOK.md](RUNBOOK.md#buyers-say-the-bot-check-fails).

### Admin two-factor (ADR-049)

This release adds migration `0024`: a new table, `two_factors`, and a
column `users.two_factor_enabled` that defaults to false. Backward
compatible (an older image ignores both), so a rollback needs nothing
extra. The app role gets its rights on the new table from the default
privileges set by `ops/db/app-role.sql` (ADR-044); nothing to run. No
new environment variable: the secrets are encrypted with
`BETTER_AUTH_SECRET`.

**After that deploy**, every admin is sent to `/admin/two-factor/setup`
at their next page load, with no way round it. Have the authenticator
app installed before you open the admin, and do setup at once (until an
admin enrols, the password alone reaches setup). Save the backup codes
in Bitwarden. Then check it once: sign out, sign in with the password,
and a code must be asked for before the dashboard opens. Ask Raj to do
the same at his next sign-in.

Enrolling signs that admin out of every other session, including the
password-only ones from before `0024` (another laptop, the phone's
browser): each signs in again there, with a code. Expected, not a bug;
it is what stops an old session counting as two-factor.

### Cloudflare Access (ADR-050)

Once the Dokploy Access app exists, the deploy call needs the service
token: repo secrets `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`
(infra/CLOUDFLARE.md § Cloudflare Access). Add them **before** creating
the app, then Run workflow once to prove a deploy still gets through. A
`403` from `curl` in the Deploy step means the token is missing or was
rotated.

## Checking where an image came from

Every image the Deploy workflow pushes carries two signed attestations
(ADR-075): its build provenance (this repository, `deploy.yml`, the run and
the commit) and its SBOM (every package inside). Check a tag with `gh`. It
needs no registry login, but it does need `gh auth login`: the attestations
are fetched through GitHub's API.

```sh
SIGNER=https://github.com/Ashfak-Hossain/EchoAndAura/.github/workflows/deploy.yml@refs/heads/main
gh attestation verify oci://ghcr.io/ashfak-hossain/echoandaura-web:sha-abc1234 --repo Ashfak-Hossain/EchoAndAura --cert-identity "$SIGNER" --deny-self-hosted-runners
gh attestation verify oci://ghcr.io/ashfak-hossain/echoandaura-worker:sha-abc1234 --repo Ashfak-Hossain/EchoAndAura --cert-identity "$SIGNER" --deny-self-hosted-runners
```

It resolves the tag to a digest and passes only if that exact image was
signed by this repository's `deploy.yml`, run from `main` on GitHub's own
runners. The output names the workflow run and the commit it signed. The
Deploy workflow only builds when that commit is the one CI passed, and
each image also carries the commit as a label, so this shows the commit:

```sh
docker buildx imagetools inspect ghcr.io/ashfak-hossain/echoandaura-web:sha-abc1234 --format '{{json .Image}}' \
  | jq -r '(if has("config") then . else .["linux/amd64"] end).config.Labels["org.opencontainers.image.revision"]'
```

If verify fails with "token was denied", the cause is usually an old
`docker login ghcr.io`: `gh` reads Docker's saved registry credentials, and
GHCR refuses an expired one even though the images are public. Run `docker
logout ghcr.io`, or run the command with `DOCKER_CONFIG` pointing at an
empty folder.

To read the package list, add
`--predicate-type https://spdx.dev/Document/v2.3 --format json` to the
verify command. The version in that URL is whatever SPDX version the
pinned Trivy writes (2.3 today); a Trivy update can change it. Every
Deploy run also keeps the two SBOMs as an artifact named `sbom` for 90
days.

A release checks the same things before it names anything: the Release
workflow verifies both images' provenance and their commit label, both
before naming either, and refuses to version an image that fails. The
version's digests are listed in its GitHub Release.

## Checking an image locally

```sh
docker build --target web --build-arg R2_PUBLIC_URL=http://localhost:9000/echoandaura -t echoandaura-web:local .
docker build --target worker --build-arg R2_PUBLIC_URL=http://localhost:9000/echoandaura -t echoandaura-worker:local .
```

Both need `R2_PUBLIC_URL`: they share one build stage, and with the same
value the second build reuses the first one's work (about a minute instead
of three).

Then run them against the local Postgres and Redis with an env file (see
the Smoke test step in `deploy.yml` for the minimum set).
