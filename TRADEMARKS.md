# Licence, name and brand

Copyright © 2026 Raj Sr, trading as Echo & Aura.

The code in this repository is free software under the
[GNU Affero General Public License, version 3 only](LICENSE)
(`AGPL-3.0-only`). You may run, study, change and share it on that
licence's terms. If you run a changed version for other people over a
network, the licence requires you to offer those users its source.

The licence covers the code. It does not cover the Echo & Aura brand or the
organizer's events. The decision is recorded in
[ADR-087](docs/decisions/087-open-source-agpl.md).

## Not covered by the licence

You may pass on exact copies of this repository and of its published
images, name and marks included, as the licence requires. Anyone who runs
the software for other people, changed or not, must use their own name and
replace the marks. Only the organizer runs it as Echo & Aura.

- **The name.** "Echo & Aura", "echo&aura" and `echoandaura` name the
  organizer. As section 7(e) of the licence allows, it grants no right to
  use them, and no copy, changed or not, may suggest the organizer runs or
  endorses it.
- **The mark and the wordmark.** The artwork in
  [src/lib/brand/marks.ts](src/lib/brand/marks.ts), the files
  [scripts/brand/assets.ts](scripts/brand/assets.ts) renders from it
  (`src/app/favicon.ico`, `public/brand/email-logo.png`,
  `docs-site/app/icon.svg`, `docs-site/lib/brand.generated.ts` and
  `.github/assets/logo-*.svg`), and the brand guide
  [docs/BRAND.md](docs/BRAND.md). All rights reserved, beyond passing on
  an exact copy.
- **Event content and photos.** Event titles, descriptions, line-ups, cover
  photos and sponsor logos belong to the organizer and the people who made
  them. They live in the production database and storage, not in this
  repository, and are not licensed. The placeholder events, covers and
  logos the seed script draws are code, and are covered.

## Third-party parts

Dependencies and bundled assets keep their own licences, found in their
packages and the notices shipped with them. For example, the ticket PDF's
fonts are under the SIL Open Font License
([src/server/pdf/fonts/LICENSE.txt](src/server/pdf/fonts/LICENSE.txt)).

## Questions

Ask about using the name or brand at
[hello@echoandaura.com](mailto:hello@echoandaura.com).
