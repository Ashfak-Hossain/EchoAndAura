---
id: ADR-034
title: 'Gate scanner offline (Slice B): a hashed list, an outbox, double entries shown not prevented'
date: 2026-09-26
status: accepted
area: Gate scanner
supersedes: [ADR-030]
extends: [ADR-030]
---

# ADR-034 — Gate scanner offline (Slice B): a hashed list, an outbox, double entries shown not prevented

**Date:** 2026-09-26 · **Status:** Accepted · extends [ADR-030](030-gate-scanner-slice-a.md)

**Context:** Venue signal fails exactly when a queue forms. In Slice A a scan
with no answer said NOT RECORDED and staff fell back to the printed list.
The door phone should keep answering, and the server should still end up
knowing who came in, where and when.

**Decision:**

- **The offline list.** `GET /door/api/list` gives the pass's event: every
  ticket's attendee name, ticket type, "N of M", status and check-in
  (time · gate). Nothing about the buyer is included, not even the phone
  digits. A ticket code goes out only as `SHA-256(salt:code)` cut to 128
  bits, with a fresh random salt per download. The phone fetches it at
  sign-in and every 60 s, and keeps it in IndexedDB (memory if IndexedDB
  is unavailable).
  - **What the hash is worth.** Codes carry about 40 bits, so anyone
    holding the list could grind through them. The hash only keeps codes
    from being read straight off a door phone. The printed backup list
    already prints them in full. A slow hash was rejected: it costs real
    server CPU every minute per gate and still falls in hours on a GPU.
  - **Where the logic lives.** `src/server/lib/door-offline.ts` is pure
    and uses WebCrypto (`crypto.subtle`, identical in Node and the
    browser), so the server and the phone hash and judge with the same
    file.
- **The offline answer.** When a scan gets no answer, the phone:
  1. judges it from the list (`judgeOffline`): admit, already in (from
     the list or from this phone since), cancelled, not on this list, or
     practice before doors open;
  2. shows that answer marked "offline";
  3. queues the scan in an outbox under a new `scanId`, with
     `supersedesScanId` set to the unanswered request.

  From then on scans skip the network until a status ping succeeds.
  - **"Not on this list" replaces "wrong event"** offline, because another
    event's ticket cannot be told apart from a made-up code.
  - **The phone's clock** is corrected by the offset it measures against
    the server's (list download and every status ping).

- **Sync.** The outbox is sent oldest first, 50 per request, to the same
  `POST /door/api/scans`. Only offline scans may be batched, and they have
  their own rate limit (30 requests a minute per pass), so emptying an hour
  of backlog never starves live scans. Each scan carries `door_verdict`,
  what the door showed:
  - **`admitted`:** the server replays it as a real check-in, with the
    same conditional UPDATE and pass lock as ADR-030. It is dated at the
    corrected phone time, clamped to `[doors open, now]`, and audited with
    "· offline".
  - **`refused` / `practice` / `undone`:** logged only; nothing is checked
    in, because nobody walked in. A ticket the server would have admitted
    is logged as the new result `turned_away`.
  - **Idempotency:** a re-sent sync replays by `scanId`, as ADR-030 does.
- **Double entries are shown, not prevented.** Two gates without signal
  cannot know about each other, so both may admit one screenshot. A double
  entry is an offline scan where `door_verdict = admitted` and the server's
  result is not `admitted`.
  - It is **not** a double entry when the online request it replaced
    itself admitted: that was the same person, and only the answer was
    lost (`supersedes_scan_id`).
  - The admit is recorded, never trusted. The check-in page lists double
    entries with both gates and times and a link to the order, and each
    gate pass shows its offline scan count.
- **Name-search admits need signal.** The buying phone's digits never
  reach the door, so offline the name search shows who someone is and
  whether they are in, but cannot admit.
- **The door's own undo** of an admit that has not been sent yet changes
  its verdict to `undone`. Once sent, the online undo applies, with its
  2-minute window counted from when the door admitted, not from the sync.
- **Session end.** End session tries to send the outbox first and warns
  when scans remain. A 401 (pass revoked, or its window over) wipes the
  list and outbox and says how many scans never reached the server.
  Outbox scans of another pass are dropped with a notice: sent under a new
  pass, their gate label would be wrong in the record.
- **Schema:** migration `0022` adds `door_scans.door_verdict` (with a CHECK:
  set exactly when `mode = 'offline'`), `supersedes_scan_id`, and a partial
  index on offline scans. Migration `0023` adds the `turned_away` result.
  The recent-scans list is ordered by when a scan happened (the phone's
  time for an offline scan), not when it arrived.

**Consequences:**

- **First-scan-wins still holds while a gate has signal.** Offline, it
  becomes "last-to-sync is flagged". The terms and privacy pages now say so.
- **Every door phone holds the event's attendee names** for the night. The
  printed list already did; they are wiped when the session ends.
- **The list is re-sent in full every minute:** about 150 bytes a ticket,
  roughly 150 KB for 1,000 tickets. That is acceptable for one event, and
  an ETag or delta can come later.
- **A reload with no signal still fails.** There is no service worker
  yet, so the tab must stay open. That is Slice B2.

**Review fixes (2026-09-26):**

- **The stored time of an offline scan is the clamped one**, not the phone's
  raw clock. A future-dated admit could otherwise hold the door's 2-minute
  undo open indefinitely.
- **A scan the phone has sent is never undone locally again**, even when the
  send got no answer: its ADMIT may already stand, and a re-send as
  `undone` under the same `scanId` cannot take it back. The server checks
  this too: a replay whose `door_verdict` differs from the stored one
  answers `scan_id_conflict`, not the stored ADMIT.
- **A phone's own "already in" mark is dropped only by a list read after
  the server is known to have had it** (sync confirmed, plus 15 s for clock
  correction). It is never dropped by when the person walked in. The list's
  "as of" is taken before its database read.
- **`sync()` waits for a send already in flight** instead of skipping it.
  Otherwise End session could sign out under that send, and its scans
  would come back 401 and be lost.

**Revisit when:** Slice B2 (a service worker so `/door` loads offline —
done, [ADR-035](035-gate-scanner-service-worker.md)); an
event large enough that the per-minute list matters; or the organizer
wants double entries to alert someone live.
