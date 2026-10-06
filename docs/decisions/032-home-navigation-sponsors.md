---
id: ADR-032
title: 'Home, navigation & sponsors (Canvas 6): logos through the server, one offer rule, a path-aware header'
date: 2026-09-25
status: partly-superseded
area: Public site
supersedes: [ADR-020]
extends: [ADR-031]
---

# ADR-032 — Home, navigation & sponsors (Canvas 6): logos through the server, one offer rule, a path-aware header

**Date:** 2026-09-25 · **Status:** Accepted, partly superseded by [ADR-033](033-covers-through-next-image.md) (covers now go through `next/image`) · supersedes the home and header parts of ADR-020; extends ADR-031's focus ring

**Context:** Canvas 6 (Claude Design) rebuilds the home page, the header
(with a full-screen phone menu) and the footer, and adds sponsors: an admin
screen (B15), "Supported by" on the home page, a row in the footer and
"Presented by" on the event page. Sponsors did not exist in the app. The
design did not cover the event page's dark title band, a list of upcoming
shows, or the admin at phone width.

**Decision:**

- **Sponsors data** (migrations `0020`, `0021`). Enums `sponsor_level`
  (presenting → partner → supporter, also the display order) and
  `sponsor_tile_tone` (light | dark). `sponsors` has the name (also the
  logo's alt text), an optional https website, the logo key, `active`,
  `position`, and `logo_width` / `logo_height` measured on upload, which
  the tile sizing formula (`src/lib/sponsor-fit.ts`) needs. They are double
  precision (> 0) because a viewBox can be fractional. A partial unique
  index, `sponsors_one_presenting`, allows one presenting partner. Saving a
  new one moves the old one to Partner #1 in the same transaction.
  Positions stay dense (1…n per level): every write takes a
  transaction-scoped advisory lock and renumbers the level. ▲▼ and the
  number field all call one `setPosition`. There is no UNIQUE (level,
  position), because a one-statement renumber that swaps two rows would trip
  it. `events.presenting_sponsor_id` is optional, `ON DELETE SET NULL`.
- **Logos go through the server, not a presigned PUT.** This deliberately
  departs from ADR-007, which covers still follow. Logos are SVG or PNG, at
  most 512 KB, under the default 1 MB server-action body limit. The server
  needs the bytes to measure the shape, to screen SVGs, and to store the
  file with `Content-Disposition: attachment`. Opening the URL directly
  downloads the file; an `<img>` still shows it. Each upload gets a fresh
  key, `sponsors/<id>/logo-<nanoid>.<ext>`, cached as immutable.
  `ObjectStorage.put` runs before the transaction, and a replaced or
  deleted logo is removed after commit, best-effort (Invariant 7). This
  needs no CORS rule, no storage read-back and no cleanup of abandoned
  uploads.
- **`inspectLogo`** (`src/server/lib/sponsor-logo.ts`) has no imports, so
  the form runs it for an instant preview. The server runs it again as the
  authority.
  - **PNG:** a valid signature with IHDR first, not Apple's CgBI format,
    16–4096 px a side.
  - **Shape, both formats:** at most 20 times wider than tall (or taller
    than wide), and a viewBox side of at most 10⁶. The tiles size a logo by
    width ÷ height, and an absurd viewBox would overflow it. `fitLogo`
    also clamps instead of throwing, so a bad stored row can never break
    the footer on every public page.
  - **SVG, accepted form:** strict UTF-8; no SVGZ, DOCTYPE, ENTITY or
    stylesheet instruction; a root `<svg>` with the SVG xmlns and a valid
    viewBox, which gives the shape.
  - **SVG, refused content:** SVG elements come from an allowlist. Script,
    foreignObject, `a`, animation elements and the XHTML and MathML
    namespaces are refused under any prefix, and so are `on*` attributes.
    Links may only be `#…` or `data:image/…;base64`, checked after decoding
    references. Styles may not use `@import`, `image-set()` or an external
    `url(`. That applies to `<style>`, `style=""` and every unprefixed
    presentation attribute (`mask`, `cursor`, `fill`…). A backslash
    anywhere in that CSS is refused, and the checks run on the text with
    and without comments, because escapes, strings and comments can hide a
    load from a simple scan. Prefixed editor metadata stays free text.

  Logos are only ever drawn with `<img>`, so the screen is defence in
  depth: a file it cannot classify is refused.

- **One offer rule for the home page and the event page**
  (`offerSummary`, `src/server/lib/event-offer.ts`).
  - **An Early Bird is recognised by shape:** its sales end before
    registration closes, and it is cheaper than the cheapest type that
    sells until the close.
  - **The "from" price** counts only types still sellable (window not
    ended, not sold out); if none are, it counts every type.
  - The same result picks the event page's highlighted row and the
    "Early Bird on sale" chip. `availableTotal` is unchanged.
- **The hero skips a show whose registration has closed** while another
  upcoming show exists (`selectHomeEvents`). This covers only closed
  shows: a sold-out or not-yet-open main show still drops the header's
  "Get tickets" (N3 follows the main show). Then the phone menu points to
  `/events` instead of saying nothing is on sale. The closed show moves to "Also upcoming" with the chip
  "Registration closed". A new `/events` page lists every upcoming show in
  the `/archive` layout, and the "Events" nav link goes there. Under the
  hero the home page shows up to three more upcoming shows, with "All
  upcoming events (n) →" when there are more, then six past shows on
  phones or four on desktop.
- **Chrome.** The dark header is used on `/` only. Three small client
  pieces read the path: `HeaderFrame` sets the tone, `SiteNavLinks` sets
  `aria-current`, and the phone menu closes when the path changes. The rest is server-rendered. The phone menu is a full
  screen on `@base-ui/react/dialog` (focus trap, Esc, focus return). It
  closes on navigation and at `lg`, and it replaces the shadcn Sheet. The
  footer navs (Tickets, About, Help) are named by their headings, and Legal
  by its label. ADR-031's focus ring now also covers `.site-chrome` and
  `.home-page`. The active link's underline is a pseudo-element, so the
  ring's box-shadow cannot erase it.
- **Chip vocabulary, sitewide** (`phaseChipLabel`): On sale · Early Bird
  on sale · Closing soon · Not on sale yet (hero) or On sale 25 Oct
  (cards) · Sold out · Registration closed · Past.
- **Adapted where the design was silent** (approved with the plan):
  "Presented by" has a dark-band variant for the event page's dark title
  band. `/events` reuses the `/archive` layout. On phones the B15 rows
  become stacked cards and the preview sits under the form. The event form
  gains a "Presenting sponsor" select, which marks hidden sponsors.
- **Repo over design:**
  - 24-hour Dhaka times;
  - "N days before the show" is computed;
  - covers stay plain `<img>`, with `fetchPriority="high"` on the hero
    (replaced by ADR-033: covers now go through `next/image`);
  - segmented controls stay radio inputs, now one shared component;
  - sponsor links carry `rel="sponsored noopener"`.

  Dropped: the drag handle (there is no drag-and-drop; ▲▼ and a number
  instead) and the grayscale "mono" logo option.

**Consequences:**

- A public page that shows sponsors reads `getPublicSponsors()`: active
  sponsors only, React-cached per request.
- A sponsor write revalidates the whole public layout, because the footer
  is on every page.
- Deleting a sponsor quietly clears "Presented by" on its events.
- Some real exports must be exported again: SVGs with a DOCTYPE (Affinity,
  CorelDRAW, older Illustrator "SVG 1.1"), Figma's background blur (a
  foreignObject), and fonts embedded in styles.
- Known follow-up: unsold stock of a type whose sales window has ended
  still counts as "left" in the four places that sum `availableTotal`: the
  home read model, the event page, the registration page and order
  creation.

**Revisit when:** a sponsor needs a separate logo for dark tiles, or
ordering by drag; the organizer wants DOCTYPE exports accepted; or
`availableTotal` should respect sales windows.
