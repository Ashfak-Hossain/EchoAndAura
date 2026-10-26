# Changelog

What changed for the organizer and for buyers, per release, newest first.
Loosely follows [Keep a Changelog](https://keepachangelog.com/). Versions
are [SemVer](https://semver.org/) tags; how to cut one is in
[docs/DEVELOPMENT.md → Releases](docs/DEVELOPMENT.md#releases). Every merge
to `main` deploys, so between releases the merged pull requests are the
detailed history.

## [Unreleased]

### The code

- The ticketing platform's code is now open source, under the GNU Affero
  General Public License 3.0. Anyone may run, change and share it; whoever
  runs a changed version for others must offer them its source. The Echo &
  Aura name, logo, event content and photos stay the organizer's and are not
  covered ([TRADEMARKS.md](TRADEMARKS.md)).

## [1.0.0] - 2026-10-14

The first release: everything built before go-live. The reasoning behind
each part is in [docs/decisions/](docs/decisions/README.md) (ADR-001 to
ADR-071).

### For buyers

- Event pages with the line-up, ticket types and prices, shareable on
  Facebook and WhatsApp with a proper preview.
- Registration in under a minute: pick a ticket type and quantity (up to
  10), enter a name, phone and email. Promo codes apply at checkout.
- Seats are held for **20 minutes** on a visible countdown while the buyer
  sends money by bKash and pastes the transaction ID.
- Tickets by email as soon as the payment is approved, with a PDF and a web
  ticket page. The name on each ticket can be changed until registration
  closes, so tickets can be passed on.
- "Find my order" by order reference and phone, and an optional sign-in by email
  link to see every order.
- 12-hour times, Bangla digits accepted in every number field, and pages
  built for a phone on a slow connection.

### For the organizer

- Events with cover images, rich descriptions, a private venue shown only
  to ticket holders, sponsors, and separate ticket types (Early Bird is its
  own type with its own sales window).
- A verification queue: check each transaction ID and amount against the
  bKash statement, then approve or reject with a reason. Approving issues
  and emails the tickets automatically.
- Orders search and CSV export, sales reports, promo codes, complimentary
  tickets, ticket cancellation, and an audit trail on every order that
  answers "who did what, and when".
- Settings for the bKash number, contact details and verification promise,
  changed without a deploy.
- Admin sign-in with a password and an authenticator app, behind
  Cloudflare Access.

### At the door

- A phone scanner for ticket QR codes, opened with a gate pass. It admits in
  under half a second, keeps working without signal, and shares check-ins
  between gates live.
- A pre-doors test on each phone, a searchable list for tickets that won't
  scan, and a printed check-in sheet as the last resort.

### Reliability and security

- Seats can never be oversold, a transaction ID can never be used twice,
  and money is counted in whole paisa, all enforced by the database.
- Production behind Cloudflare: bot checks on public forms, limits on
  orders per phone and per network, load shedding, security headers, and
  an origin that answers Cloudflare only.
- Nightly backups with an off-site copy, hourly during a sale; uptime and
  disk alerts; private error tracking; images scanned for critical
  vulnerabilities before every deploy.

[Unreleased]: https://github.com/Ashfak-Hossain/EchoAndAura/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Ashfak-Hossain/EchoAndAura/releases/tag/v1.0.0
