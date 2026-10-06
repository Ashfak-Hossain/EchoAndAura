---
id: ADR-020
title: Public design pass to the approved canvas
date: 2026-09-21
status: partly-superseded
area: Public site
supersedes: []
extends: []
---

# ADR-020 — Public design pass to the approved canvas

**Date:** 2026-09-21 · **Status:** Accepted — the home page and header
parts superseded by
[ADR-032](032-home-navigation-sponsors.md)

**Context:** The public site was functionally complete but read as a
demo: a hero in a card, a grid of six identical cards, three empty trust
boxes, a one-row footer, an event page with an empty right column. A
Claude Design canvas (four artboards: home and event at 1440 and 390)
was approved on 21 Sep and this pass makes the code match it.

**Decision:**

- **Same tokens, more contrast.** Nothing new in `globals.css`: the pass
  uses the existing palette and type scale but alternates light and
  charcoal full-bleed bands (hero, trust band, footer) so the page has
  rhythm. Archivo display sizes go up to 64px on the hero only.
- **The header's "Get tickets" comes from the home read model.**
  `src/app/(public)/home/load.ts` wraps `eventsService.getHomePage()` in
  React `cache()`; the public layout reads the featured event's slug and
  phase from it and the home page reads the rest — one query per request,
  no new repository method. The button is omitted (not disabled) when
  nothing is on sale.
- **Home caps.** "Also upcoming" renders at most three cards on the home
  page (the selector still returns six for a future events list); the
  past strip shows four. `HomeEvent` gained `availableTotal` for the
  hero's "N left" — computed from the capacity roll-up already fetched
  (not shown when the event hides its counts, see ADR-055).
- **Event page: the band is the cover.** On desktop the cover is the
  darkened backdrop behind title/date/venue; on phones it sits above the
  band. The tickets card is rendered twice (inline on phones, sticky on
  desktop) with the CTA only in the desktop copy — the phone has the
  bottom bar. The "deal" row (open type whose sales end soonest) is
  tinted marigold; there is no Early Bird flag in the data model.
- **Icons are inline stroke SVGs** (`home/icons.tsx`), no icon font, no
  emoji. Mobile nav is the shadcn Sheet, like the admin.

**Consequences:** e2e selectors that assumed one occurrence of the venue
or the cover now target the visible copy (`event-cover` is the desktop
backdrop, `event-cover-mobile` the phone image; the footer nav is
`Site pages`, the header nav `Site` with `exact: true`). The dormant
home state (`NoLiveEvent`) was already charcoal and is unchanged.

**Revisit when:** real cover photos land (the date tile and scrim were
tuned on placeholders), or an "All events" list page exists to link the
"Also upcoming" heading to.
