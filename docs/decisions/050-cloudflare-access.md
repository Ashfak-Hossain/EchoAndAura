---
id: ADR-050
title: Cloudflare Access in front of the admin area and Dokploy
date: 2026-10-03
status: accepted
area: Security and auth
supersedes: []
extends: []
---

# ADR-050 — Cloudflare Access in front of the admin area and Dokploy

**Date:** 2026-10-03 · **Status:** Accepted

**Context:** After ADR-048 and ADR-049, the admin sign-in page is
bot-checked and the account needs password + authenticator code. But the
page itself is still public: anyone can try it, and every sign-in flaw
(ours or better-auth's) is reachable from the whole internet. The same is
true of the Dokploy dashboard, which controls the server. Only two people
ever need either.

**Decision:**

- **Cloudflare Access (Zero Trust free plan)** asks for an approved email
  and a one-time code, sent by Cloudflare, before any request reaches
  `echoandaura.com/admin` or `deploy.echoandaura.com`. Admin: the
  developer and Raj. Dokploy: the developer only. Sessions last **one
  week**: password + 2FA still run on every admin sign-in, so the outer
  gate doesn't need to be frequent. The addresses live in the Access
  policy and Bitwarden, not in this public repo.
- **The web verifies Access's token on every `/admin` request**
  (`src/lib/cf-access.ts` in `src/proxy.ts`, with `jose`): signature from
  our team's keys, the Admin app's audience, not expired; otherwise a bare
  `403` before anything renders. Origin lockdown (ADR-045) only proves a
  request came through _a_ Cloudflare edge, and those addresses are shared
  by every Cloudflare customer: a Worker on another account could reach the
  origin with our `Host` header and never meet our Access policy. Admin
  prefetches are checked too (a prefetch carries the page's render).
  Two settings switch it on (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`);
  both empty = off (dev, e2e, rollout), one set = error.
- **GitHub's deploy call** passes Dokploy's Access app with a service
  token (`CF-Access-Client-Id/Secret` headers), sent when the two repo
  secrets exist. Dokploy can't verify the token itself; its login, 2FA and
  API key remain.
- **Not behind Access:** `/door` (gate phones must work offline with a gate
  pass; an email login would break event night), the public site, `/api/*`.
- **Two more WAF rules:** `block scanners` (WordPress/PHP/.env/.git probes,
  on) and `emergency - outside Bangladesh` (managed challenge, **off**
  until an attack; RUNBOOK). **DNSSEC** on.
- **Rollout order** so nothing locks out: code merged with the check off →
  service token in GitHub → Dokploy app (a deploy must still work) → Admin
  app → AUD + team in Dokploy → deploy.

**Consequences:**

- The admin sign-in page, reset page and code step are invisible to the
  internet; attacks on them need an approved inbox first.
- Raj gets a Cloudflare email code about once a week per device, before
  the usual sign-in. Losing that inbox locks him out until the developer
  edits the policy (infra/CLOUDFLARE.md § Change it later).
- A Cloudflare Access outage makes `/admin` unreachable for its length;
  the public site, the door and the data are unaffected. Off switch:
  empty `CF_ACCESS_AUD` and redeploy.
- One new dependency, `jose`, pinned exactly.

**Rejected:** Cloudflare Tunnel instead of the public origin (a bigger
change to the deploy path for the same result, given origin lockdown and
the token check); Authenticated Origin Pulls (proves Cloudflare, not our
Access app); Access on `/door` (offline scanning); IP allow-lists (mobile
networks change addresses); Workers Paid features (nothing here needs
them).

**Revisit when:** more admins (consider an identity provider instead of
email codes), passkeys (ADR-049), or the door gets a staff login.
