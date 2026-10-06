---
id: ADR-029
title: 'Private venue: stripped from the public read models, revealed to ticket holders'
date: 2026-09-23
status: accepted
area: Public site
supersedes: []
extends: []
---

# ADR-029 — Private venue: stripped from the public read models, revealed to ticket holders

**Date:** 2026-09-23 · **Status:** Accepted

**Context:** Some events should not advertise their venue in public posts
or on the site; only people with tickets should learn it. The venue was on
every public surface (home hero and cards, event page with a Maps link,
registration, archive, the Open Graph text).

**Decision:**

- **Two event columns** (migration `0017`): `venue_hidden` (default false —
  existing events unchanged) and `venue_area`, an optional public hint
  ("Tejgaon, Dhaka"). CHECK `events_hidden_venue_set`: a private venue must
  exist, because ticket holders are promised one. The form refuses the same
  thing; the area is stored only while the venue is private.
- **Removed at the source, not at each page.** `eventsService.getPublicEvent`,
  `getHomePage` and `getArchivePage` — the only reads public pages use —
  pass every event through `forPublic` (`src/server/lib/venue.ts`), which
  sets `venue` to null when it is private. A page cannot print, link or
  serialise into the RSC payload a value it never received. `publicVenue` /
  `publicVenueLine` decide what is shown: the area plus "Exact venue is sent
  with your tickets", no Maps link (an area is the wrong door). The archive
  shows the area alone (the note is moot after the event). `seo.ts` uses
  `publicVenue` too, so share text is safe even from an unstripped event.
- **Ticket holders read the full event** through the paths that already
  gate on an issued ticket: C2 (with "please don't share it widely"), the
  web ticket page, the PDF and the calendar file. A buyer awaiting
  verification never sees it — A4 and C1 never showed the venue. Admin
  screens show it as before; the events list marks "private venue".

**Consequences:** A new public page must read through those service
methods (or call `forPublic`) — reading the repository directly would
skip the strip. Facebook keeps its cached preview until it re-scrapes a
URL. The e2e checks the raw server response of four public pages for the
venue string, which covers the inlined RSC payload.

**Revisit when:** the venue should be revealed to everyone a set time
before doors, or to buyers the moment they register.
