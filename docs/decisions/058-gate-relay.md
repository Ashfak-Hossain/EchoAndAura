---
id: ADR-058
title: 'Gate relay: door phones share check-ins through a Cloudflare room, live and without our server'
date: 2026-10-05
status: accepted
area: Gate scanner
supersedes: []
extends: [ADR-053]
---

# ADR-058 — Gate relay: door phones share check-ins through a Cloudflare room, live and without our server

**Date:** 2026-10-05 · **Status:** Accepted · extends [ADR-053](053-gate-scanner-race-both.md)

**Context:** Gates learn of each other's check-ins through the status ping,
every 5 s (ADR-053). A copied ticket at two gates within one ping can get
two early ADMITs, and when our server is down, gates do not hear of each
other at all: each answers from its own list (ADR-034), so the same
ticket can be admitted at every gate. Workers Paid was bought on
2026-10-04, which brings Durable Objects.

**Decision (owner-approved plan, 2026-10-05; reworked after the
code-reviewer's findings the same day):**

- **One room per event on Cloudflare** (`relay/`, Worker
  `echoandaura-relay` at `relay.echoandaura.com`). A Durable Object per
  event holds the door phones' WebSockets (hibernating, so an idle room
  costs nothing) and the check-ins heard so far in its own SQLite, kept
  until a day after the last pass, announcement or revoked pass's expiry.
  Its tables carry a schema version: a room from older code has its
  check-ins rebuilt empty and gets a new epoch; its revocations are kept
  (they are security state).
- **A relay, never a judge.** Postgres still decides every check-in
  (ADR-030). The room only spreads "ticket X is in" into the phones'
  marks. Refusals still wait for the server (ADR-053).
- **Two kinds of row, never confused.** A phone's admit is a **claim** of
  its **pass** (not its gate name, which two passes can share). Our server's
  announcement is **confirmed**: it replaces a claim. Only the claiming
  pass may take back its claim, and only while unconfirmed; no phone can
  remove a confirmed row. The server's undo names the check-in it undid
  (its time): it removes that check-in, or a claim from before it (5 s
  slack), never a re-admit or a newer offline claim — so a late or
  retried undo is harmless; a phone whose own unsent admit lost its row
  re-sends it at once. Taken-back check-ins stay as tombstones with their
  own seq. A revoke closes the pass's sockets, keeps it out, takes back
  its unconfirmed claims, and keeps the room at least until the pass's
  window ends.
- **On the phone** each mark remembers its source (this phone, the
  server, the relay). Another gate's unconfirmed claim survives list
  downloads until the server confirms it; a gate's undo can clear only
  such a claim, never what the server or the ping vouched for; this
  phone's own unsent admit is never cleared by anyone. These rules are
  pure (`src/app/door/offline/rules.ts`) and unit-tested.
- **Catching up by sequence, not by time.** Every change in a room gets
  the next `seq`; a reconnecting phone asks for what came after the last
  seq it heard **in that room's epoch** (a rebuilt room starts it over),
  so a late offline admit or a phone with a fast clock cannot hide rows
  from it, and undos it missed (tombstones) are replayed. The catch-up is
  sent in pages of 1,000 rows, all of it.
- **Nothing is lost on a dead link.** A phone re-sends its unconfirmed
  admits and pending undos whenever its link opens — in batches of 200
  as single messages (one rate unit each), so a gate back from a long
  outage with hundreds of offline admits is not rate-limited off the
  relay — and treats a socket with no pong for 65 s as dead.
- **A signed relay pass**, so the room needs no call to our server:
  `base64url(claims).base64url(HMAC-SHA256)` with a secret both sides hold
  (`src/server/lib/relay-pass.ts`, one file used by both). It names the
  event, the gate pass and its gate, and expires with the pass's window.
  It comes inside the offline list the phone already downloads and saves
  (ADR-034), so a reload without signal can still join. It travels in the
  WebSocket subprotocol (`ea-relay.v1, <pass>`), never in a URL; the
  Worker refuses a bad pass, a wrong role, a wrong event or a foreign
  `Origin` before the room is touched. The relay's invocation logs are
  off, so no pass lands in Cloudflare's logs.
- **Who tells whom.** A phone sends its own admits (online, early or
  offline) and its own offline undos. Our server, **after each commit**,
  queues an announcement (check-in, undo, revoke) on its own BullMQ queue
  `relay`; the worker delivers them one at a time, in order, with six
  tries over ~30 s — a revoke twelve, over ~2 hours (Invariant 7; "all I/O
  is queued"). A lost one costs speed only, except a revoke: until it
  lands a leaked pass can still join the room, hence the long retry.
- **Limits:** messages ≤ 1 KB (a re-send batch ≤ 32 KB, 300 items); 50
  messages per pass per 10 s and 4 sockets per pass (the oldest gives way;
  the evicted phone waits a minute); 2,000 rows per pass — its claims and
  the tombstones of its own undos, so claim/undo churn cannot grow a room
  (logged when reached); 20,000 rows per room for claims (the server's
  rows are never capped); a phone's time within 5 minutes ahead and 36
  hours behind.
- **The ping stays** as the fallback; with `RELAY_URL`/`RELAY_SECRET`
  unset the door works exactly as before. The scanner shows **Live**,
  **Linking** or **Off** next to the count.

**Consequences:**

- A check-in reaches every other gate in milliseconds (measured locally:
  5 ms phone to phone; 24 ms server → queue → worker → room → phone), and
  still does when our server is down.
- A stolen gate pass can at worst add unconfirmed "already in" claims
  (capped), which can delay a valid ticket only while the server is
  unreachable; it cannot remove anything the server confirmed. A leaked
  `RELAY_SECRET` is worse: it can forge the server's word in the room
  (still never a check-in in Postgres) — rotate it at once.
- Deployed by hand (`pnpm relay:deploy`), never by CI, and not mid-event
  (a schema change rebuilds rooms). `RELAY_SECRET` is set in the Worker
  and in Dokploy (web and worker) and rotated together.
- The e2e suite runs the relay locally with wrangler (no account needed):
  phone-to-phone sharing with the ping cut and with the server
  unreachable, a reconnect re-sending 120 claims, and every refusal of
  the Worker; `door-race.spec.ts` blocks
  the relay for the gate whose ignorance it tests.
- The door's CSP gains the relay's `wss://` origin, on door pages only.
- Cost: well inside Workers Paid's included Durable Object usage.

**Rejected:** server push over SSE through our own server (no help when
the server is down, which is when it matters most); KV or D1 at the edge
for check-ins (eventually consistent, and a second source of truth);
judging check-ins at the edge (Postgres stays the one truth); the pass in
the URL (it would land in logs); a first-message handshake (it leaves
unauthenticated sockets to clean up); announcing straight from the web
request (lost on a blip, out of order, against "all I/O is queued"); a
per-gate-name undo rule (names are not unique — the reviewer's blocker).
