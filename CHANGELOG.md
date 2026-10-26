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

### Reliability

- The off-site backup is now restored on purpose, monthly and before every
  event: a drill rebuilds the newest copy in a throwaway database on the
  server and checks it against the live one, orders and audit trail
  included. A backup that would not restore is found before it is needed.

### Security

Publicly known vulnerabilities fixed since 1.0.0 in what the site's
images ship. All were patched on 2026-10-25, in production the same day.
None is known to have been used against the site.

- **Next.js** 16.4.0 → 16.4.1: two critical flaws that let anyone run code
  on the server without signing in (GHSA-2464-fhr4-w9xw,
  GHSA-673q-mjm6-r5xr), and a server-action denial of service
  (CVE-2026-94482, GHSA-p3m5-59mp-jv5r). The two critical ones need SVG
  through the image optimizer or `use cache` functions; the site used
  neither.
- **Node.js** 26.10.0 → 26.12.1, the security release: CVE-2026-106069,
  CVE-2026-105482, CVE-2026-105483, CVE-2026-111497 (high);
  CVE-2026-105481, CVE-2026-106072, CVE-2026-106074 (medium);
  CVE-2026-106070, CVE-2026-106071, CVE-2026-106073 (low).
- **zod** 4.6.5 → 4.6.6: oversized input could exhaust memory during
  validation (CVE-2023-54404, GHSA-mrhx-c7xc-m3w5).
- **nodemailer** 10.0.16 → 10.1.4: three email-address parsing flaws
  (GHSA-85x2-q946-cp5h, GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w).
- **sanitize-html** 2.18.0 → 2.18.1: deeply nested HTML could crash the
  sanitizer (CVE-2026-113650, GHSA-c9rx-x947-fp3h). Our settings kept event
  descriptions off that path; a test now holds it.
- Installed in the images but never run by the site, patched all the same:
  **fast-uri** 3.1.8 → 3.1.9, used only by the email-preview tool
  (CVE-2026-110725, CVE-2026-110095, CVE-2026-110306, CVE-2026-110180), and
  **vite** 8.3.0 → 8.3.3 with **launch-editor**, development-server code
  (CVE-2026-112942, CVE-2026-112943, CVE-2026-112944, CVE-2026-112945,
  CVE-2026-112946, CVE-2026-112947).

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
