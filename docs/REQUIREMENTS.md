# Requirements

Status: DRAFT — not client-signed · Owner: unassigned · Last updated: 2026-08-21

This is meant to be the signed scope — the single source of truth for what is
and isn't in the MVP. It is currently a draft derived from `CLAUDE.md`; it has
not been reviewed and confirmed with the client (Raj).
Do not treat anything below as final until this status line changes to
`ACTIVE — signed off`.

---

## Confirmed scope

Restated from [../CLAUDE.md § Business rules](../CLAUDE.md) — that file stays
authoritative; if this list and `CLAUDE.md` ever disagree, `CLAUDE.md` wins
and this file is stale.

- Public event listing, event detail, and registration
- One order = one ticket type, any quantity, max 10 per order
- Manual bKash payment: buyer submits trxID + sending number, admin verifies
  against the bKash statement, approve/reject with audit trail
- 24-hour inventory hold from order submission; released on rejection or expiry
- Named, transferable tickets — buyer can edit attendee name until
  registration closes
- Registration window: opens 20 days before the event, closes 5 days before
- Early Bird as a separate ticket type with its own sales window
- Promo codes: percentage or fixed, unlimited uses, restrictable by ticket type
- Admin can cancel a ticket (releases inventory); refunds happen outside the
  system
- Check-in at the gate: door phones scan the ticket QR with a per-gate pass
  (first scan wins, name search as a fallback); the printed/exported list is
  the backup ([ADR-030](DECISIONS.md)). Without signal a door phone answers
  from a downloaded ticket list and syncs its scans later; double entries
  are shown to the organizer ([ADR-034](DECISIONS.md)). Reloading the page
  while offline (a service worker) is the next slice
- Sponsors, managed by the admin: one presenting partner, partners and
  supporters, each with an uploaded SVG or PNG logo and an optional
  website, shown on the home page ("Supported by") and in the site footer;
  hidden sponsors are kept but not shown. An event can name one presenting
  sponsor, shown on its page as "Presented by" ([ADR-032](DECISIONS.md))

## Explicit out-of-scope

Deferred to post-launch. **Everything not explicitly in scope above is out of
scope** for the MVP.

- bKash API integration, tokens, callbacks, reconciliation jobs (see
  [DECISIONS.md — ADR-001](DECISIONS.md))
- Custom field builder per event
- Bangla localisation
- Waitlist
- Reminder emails

## Open decisions (TBD)

These are open and block their respective phases:

- **Domain name** — blocks email sending entirely (Resend needs a verified
  domain). BLOCKING.
- **bKash merchant account** — client currently has no merchant account;
  MVP assumes personal bKash, which has receiving limits. See
  [DECISIONS.md — ADR-001](DECISIONS.md). BLOCKING for scale, not for launch.

## Stakeholders

- **Raj** — client, event organizer, admin user of the verification queue.

## Change log

Scope changes get an ADR, not an edit war on this file. See
[DECISIONS.md](DECISIONS.md).
