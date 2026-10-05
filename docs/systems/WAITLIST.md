# Waitlist: seats that come back go to the next person in line

Status: PROPOSED · Owner: Evan · Last updated: 2026-10-04

When a ticket type is sold out, a buyer can join its waitlist. When seats
come back, they are **held for the next person in line**, who gets an email
and **60 minutes** to claim them. A claim turns the held seats into a normal
order with the usual 20-minute payment hold. An unclaimed offer passes to
the next person. Decided with the owner on 2026-10-04: reserved offers, not
"email everyone"; 60 minutes to claim. Each slice gets its ADR when built.

---

## Why it matters here

Sold out is often temporary on this site. During an on-sale rush, many
seats sit in 20-minute holds for people who never pay (ADR-054), and a
rejected payment or a cancelled ticket also frees seats. Without a
waitlist those seats go to whoever refreshes at the right second. With
one, they go to people in the order they asked, and Raj sees real demand:
"40 people are waiting for General", which tells him whether to add
seats.

## Goals

- **Fair:** seats go in the order people joined. The public cannot take a
  seat while someone is waiting for it.
- **Safe:** Invariant 2 is unchanged. Offered seats sit in
  `quantity_reserved` like any hold, so the count can never go wrong and
  the CHECK constraint still backstops it.
- **Nothing is lost:** every seat that comes back is either offered or
  returned to the public, inside the same transaction that freed it.
- **Auditable:** "why did she get the seats before me?" is answered from
  the database.

## Out of scope

- SMS. Email only, like every other message.
- Paying from the waitlist. A claim leads into the normal order flow, so
  payment, verification and tickets do not change at all.
- Choosing seats. There are no seat maps.

---

## The flow

```
Sold out ──► Join (name, email, how many, "all together only?")
                │  confirmation email, with a link to leave
                ▼
            waiting ──── seats come back ────► offered (seats held, 60 min)
                ▲                                 │            │
                │                         claims in time    no claim / declines
                │                                 ▼            ▼
                │                       order (pending_payment, 20 min)   seats → next in line
                │                                 │
                └── the order expires or is rejected: seats → next in line
```

## Data model (one migration)

**`waitlist_entries`**: one row per person per ticket type.

| Column                             | Notes                                                              |
| ---------------------------------- | ------------------------------------------------------------------ |
| `id`, `event_id`, `ticket_type_id` |                                                                    |
| `name`, `email`, `phone?`          | Email stored normalised (lower-cased, trimmed)                     |
| `quantity`                         | 1–10, the same limit as an order                                   |
| `together_only`                    | Boolean: offer only if all `quantity` seats are free at once       |
| `locale`                           | `en` or `bn`: the language of every email to this person           |
| `status`                           | `waiting` → `offered` → `claimed`, or `left` / `lapsed` / `closed` |
| `joined_at`                        | The place in line (ties broken by `id`)                            |
| `leave_token_hash`                 | SHA-256 of the token in the "leave the list" link                  |

- Partial UNIQUE index on `(ticket_type_id, email)` where `status` is
  `waiting` or `offered`: one place in line per person per type.

**`waitlist_offers`**: one row per offer.

| Column                             | Notes                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `id`, `entry_id`, `ticket_type_id` |                                                                          |
| `quantity`                         | Seats held for this offer (may be fewer than asked, see below)           |
| `expires_at`                       | `min(now + 60 min, registration close, the type's sales end)`            |
| `status`                           | `open` → `claimed` (with `order_id`) or `expired` / `declined`           |
| `token_hash`                       | SHA-256 of the claim link's token; the token itself is only in the email |

**`waitlist_events`**: append-only, like `order_events` (Invariant 6):
joined, offered, claimed, declined, lapsed, left, closed, removed by
admin. Who, what, when, old and new status.

**`events.waitlist_enabled`**: boolean, default true. A per-event switch on
the event form, like "Hide how many tickets are left".

## The hand-off: the core rule

One function, `waitlistService.handOff(ticketTypeId, tx)`, runs **inside
the same transaction as every change that frees seats**:

| Seats come back because…             | Where                                 |
| ------------------------------------ | ------------------------------------- |
| A 20-minute hold expired             | `orders.service` expiry (holds queue) |
| Raj rejected a payment               | `fulfilment.service` reject           |
| Raj cancelled an issued ticket       | `fulfilment.service` cancel           |
| Raj raised a type's quantity         | `ticket-types.service` update         |
| An offer expired or was declined     | `waitlist.service` (holds queue)      |
| Someone joined while seats were free | `waitlist.service` join               |

What it does:

1. The `UPDATE` that freed the seats already holds the ticket type's row
   lock until the transaction ends, so no public order can take the seats
   in between.
2. It reads the free count (`total − sold − reserved`) and walks the
   `waiting` entries in line order (`FOR UPDATE SKIP LOCKED`).
3. For each entry it offers `min(free, quantity)` seats. A `together_only`
   entry that does not fit is **skipped and keeps its place**: a family of
   four does not block a single seat, and does not lose its turn.
4. Each offer reserves its seats with **the same atomic conditional
   `UPDATE` as an order** (Invariant 2), then inserts the offer row and the
   audit row.
5. It stops when the free seats or the line run out. What is left over is
   on public sale, as today.

The emails go out **after commit**, through the queue (Invariant 7).

**Why this is enough:** freed seats never become visible to the public
while someone is waiting, because the freeing and the offering commit as
one. The seats in an offer are in `quantity_reserved`, so the public page
correctly says "sold out" and every existing count, report and CHECK
constraint keeps working with no change.

**Safety net:** the existing `expire-holds` job (every 60 s) also runs
`handOff` for any type that has free seats and people waiting. If a code
path that frees seats is ever added without calling `handOff`, the line
still moves within a minute, and a log warning names the type.

**Rejected:** adding "nobody is waiting" to the public hold `UPDATE`. It
would change Invariant 2's statement for a case the hand-off already
covers, and it would leave seats idle whenever the head of the line wants
more than are free.

## Partial offers

The head of the line wants 4, and 2 come back:

- **Not `together_only`:** they are offered 2. The email says "2 of the 4
  you asked for". Claiming 2 ends their place in line (they can join again
  for more). Declining passes the 2 on and also ends their place.
- **`together_only`:** they are skipped, keep their place, and are offered
  4 when 4 are free at once.

## Claiming

- The offer email links to `/waitlist/<token>`: the event, the seats, the
  price, and the time left (the same countdown component as the order
  page, ADR-054). Two buttons: **Claim** and **I don't need them**.
- **Claim** opens the normal registration page in offer mode: the ticket
  type and quantity fixed, name and email filled in from the entry. Promo
  codes still apply.
- Submitting creates the order **in one transaction**: lock the offer
  (`FOR UPDATE`), check it is `open` and not past `expires_at`, insert the
  order as `pending_payment`, and mark the offer `claimed` with the order
  id. **No inventory change happens**: the offer's seats become the
  order's hold. The order's audit row says it came from a waitlist offer.
- From there the order is a normal order. If its hold lapses or the payment
  is rejected, the seats go to the next person in line through `handOff`.
- A claim after `expires_at` is refused with "This offer has ended"; the
  60 minutes have no hidden grace (unlike ADR-054's two minutes, nothing
  here is in flight when the clock runs out).

## Expiry and closing

- **Offer expiry:** the `expire-holds` job also expires open offers
  (`FOR UPDATE SKIP LOCKED`, its own transaction each, like order expiry):
  the offer becomes `expired`, the entry `lapsed`, the seats are released
  and `handOff` runs in the same transaction. The person gets a "your
  offer ended" email.
- **Offers never outlive registration:** `expires_at` is capped at
  registration close and the type's sales end. If under 10 minutes would
  be left, no offer is made and the seats go on public sale.
- **When registration closes**, waiting entries become `closed` and get one
  "it didn't free up this time" email.

## Joining

- A sold-out ticket type on the event page shows **Join the waitlist**
  instead of a dead "Sold out" chip (when `waitlist_enabled`).
  `/events/<slug>/waitlist` is the join page: name, email, phone
  (optional), how many, and "only if we can all go together".
- The confirmation says the person's place in line ("3 people are ahead
  of you"), never how many seats exist, so it is safe for events that hide
  their counts (ADR-055).
- If seats happen to be free when they join, `handOff` runs in the join
  transaction and they get an offer at once.
- Turnstile and the existing per-IP rate limit, as on registration.
  Joining twice with the same email shows the existing place.
- Every email has a one-click **leave the list** link (token, no sign-in).
- A signed-in buyer's account page lists their waitlist places.

## Emails (four new kinds)

| Kind              | When                                         |
| ----------------- | -------------------------------------------- |
| `waitlist-joined` | After joining: place in line, link to leave  |
| `waitlist-offer`  | Seats held: the link, the deadline (12-hour) |
| `waitlist-lapsed` | The offer ended unclaimed                    |
| `waitlist-closed` | Registration closed while still waiting      |

The dispatcher today is keyed by `orderId`; these jobs carry an `entryId`
or `offerId` under a `waitlist.` prefix. Every one goes in the entry's
`locale`.

**Prerequisite for going live:** reliable delivery to any address. SES is
still in the sandbox, so the waitlist is switched on in production only
after the email switch (Cloudflare Email Service).

## Admin

- An event's **Waitlist** tab, per ticket type: people waiting, seats in
  open offers, claimed, converted to paid; the line in order with each
  person's status; remove someone (audited, with a reason); CSV export.
- The ticket types page shows demand next to stock ("31 waiting for 4
  seats"). Raising the quantity hands the new seats to the line at once.
- The event switch turns the waitlist off; existing entries are closed with
  the closing email.

## Edge cache

The event page's "Join the waitlist" is the same for every visitor, so it
stays cacheable. `/events/<slug>/waitlist` and `/waitlist/<token>` are
personal or form pages: the cache rule's exclusion grows from
`/register` to `/register` and `/waitlist`, and `/waitlist/` is never on
the list.

## Privacy

Waitlist entries hold personal data. They are kept until 30 days after
the event (for Raj's demand report), then anonymised (name, email and phone
cleared; counts kept). The privacy policy gains a paragraph.

## Tests

The concurrency tests matter most, alongside
`inventory.concurrency.test.ts`:

- A release and a public order racing for the same seat, with someone
  waiting: the person waiting always gets it, every time, over many runs.
- Two claims of one offer at once: exactly one order.
- A claim racing the offer's expiry: one wins cleanly, and the counts stay
  exact.
- Every seat-freeing path calls `handOff` (one test per row of the table).
- `together_only` skipping keeps the skipped person's place.
- Inventory sums: `sold + reserved` equals the sum of live holds plus open
  offers, after every scenario.

## Slices

| Slice  | What                                                                                                                          | Size    |
| ------ | ----------------------------------------------------------------------------------------------------------------------------- | ------- |
| **W1** | Tables, join page, confirmation and leave links, the event-page button, read-only admin list                                  | 1½ days |
| **W2** | `handOff` in every seat-freeing path, offers, offer email, expiry job; the concurrency tests                                  | 1½ days |
| **W3** | The claim page, registration in offer mode, order from offer, decline                                                         | 1 day   |
| **W4** | Admin tab (remove, CSV, demand), closing at registration end, the event switch, retention, cache rule exclusion, privacy text | 1 day   |

W2 touches inventory, so it gets the `code-reviewer` agent and its own ADR
(it revisits ADR-011 and ADR-012, which both anticipated this).
