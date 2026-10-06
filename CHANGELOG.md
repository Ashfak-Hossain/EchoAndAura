# Changelog

What changed for the organizer and for buyers, per release, newest first.
Loosely follows [Keep a Changelog](https://keepachangelog.com/). Versions
are [SemVer](https://semver.org/) tags; how to cut one is in
[docs/DEVELOPMENT.md → Releases](docs/DEVELOPMENT.md#releases). Every merge
to `main` deploys, so between releases the merged pull requests are the
detailed history.

## [Unreleased]

Everything before go-live, released together as **1.0.0**. The build log
is `docs/decisions/` (ADR-001 onwards) and the pull requests.

- Event pages, registration and bKash payment with manual verification.
- Tickets by email, with a PDF and a web ticket page.
- The admin: events, orders, check-in, reports, promo codes and
  complimentary tickets.
- A door scanner that also works offline.
- Production on a monitored VPS, with nightly backups.
