---
id: ADR-045
title: Only Cloudflare reaches the origin
date: 2026-09-29
status: accepted
area: Security and auth
supersedes: []
extends: []
---

# ADR-045 — Only Cloudflare reaches the origin

**Date:** 2026-09-29 · **Status:** Accepted

**Context:** The site is proxied by Cloudflare, but the server answered
anyone: `curl --resolve echoandaura.com:443:160.25.226.166` returned the
site with a 200. The address was public (the DNS-only `deploy` record,
DNS history, certificate logs). Rate-limit keys were already safe from
spoofing (ADR-037), but anyone skipping Cloudflare also skipped its DDoS
protection and any WAF or rate-limit rule added there. On a 2-vCPU
server, a flood straight at the origin would take the site down during a
sale.

**Decision:**

- **The server accepts 80/443 from Cloudflare's ranges only.**
  - IPv4: Docker publishes Traefik through NAT, so the traffic passes
    `FORWARD`, not ufw. `ops/server/origin-lockdown` adds a jump from
    `DOCKER-USER` (the chain Docker leaves to the operator) to its own
    `ORIGIN-LOCKDOWN` chain: Cloudflare's ranges return, everything else
    drops. Only new inbound connections on `eth0` are matched
    (`--ctdir ORIGINAL`), so the containers' own outgoing traffic is
    untouched. UDP 443 too.
  - IPv6: Docker serves it through `docker-proxy`, which ufw does filter,
    and Cloudflare reaches the origin over IPv4. So ufw's 80/443 rules
    are deleted. The script sets the IPv6 `DOCKER-USER` rules anyway, in
    case Docker starts NAT-ing IPv6.
  - A systemd unit runs the script after Docker starts and again
    whenever Docker restarts (`PartOf=docker.service`), because
    `DOCKER-USER` rules don't survive a reboot on their own. The script
    is idempotent and has `status` and `remove` (an instant rollback).
- **`deploy` is proxied too.** Otherwise the dashboard and GitHub's deploy
  call would be locked out with everyone else. This reverses the earlier
  "DNS only" choice (SERVER.md § 9), whose reason was that bot checks
  could block the deploy call: a WAF custom rule now skips Cloudflare's
  challenges for `deploy.echoandaura.com/api/*`. Dokploy's API key
  still guards those calls. Bot Fight Mode stays off (it can't be skipped
  per path on the free plan).
- **One list of Cloudflare ranges, three copies:** the app
  (`src/lib/client-ip.ts`), Traefik's `trustedIPs`, and this script. A
  unit test keeps the script equal to the app.
- **Checked from outside:** `pnpm infra:check` expects `deploy` to resolve
  to Cloudflare, and a direct HTTPS request to the server's address to
  get no answer.

**Consequences:**

- The site and the dashboard go through Cloudflare, including its limits
  (100 s per request, 100 MB uploads): fine for Dokploy's API and the
  app.
- Debugging "straight at the server" now means the SSH tunnel (SERVER.md
  § 9), which the lockdown never blocks.
- When Cloudflare changes its ranges, all three copies change together;
  a range missing from the script drops real visitors routed through it.

**Rejected:** Cloudflare Tunnel (no open ports at all, but a new daemon in
the request path and a bigger change to Traefik's setup); Authenticated
Origin Pulls (mTLS) alone (packets still reach Traefik and cost CPU
before being refused).

**Revisit when:** the server gets a second public service, or Cloudflare
Access is put in front of the dashboard.
