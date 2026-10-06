---
id: ADR-031
title: 'Help & policies (Canvas 5): content as data, repo copy wins, an accessible focus ring'
date: 2026-09-25
status: accepted
area: Public site
supersedes: []
extends: []
---

# ADR-031 — Help & policies (Canvas 5): content as data, repo copy wins, an accessible focus ring

**Date:** 2026-09-25 · **Status:** Accepted

**Context:** The static pages (Terms, Privacy, Refunds, FAQ, About, Contact)
were redesigned in Claude Design as Canvas 5 ("A7 evolved"): a policy
switcher, a short version, a table of contents, numbered sections with
anchors, callouts, FAQ topics, an editorial About, contact cards and an A4
print. The design was drawn from an older copy of the repo's wording.

**Decision:**

- **Policies are data** (`src/content/policies/*.tsx`): each is a purpose
  line, a short version and `{ id, title, body }` sections. The table of
  contents, the numbered sections, the anchors and the printed page come
  from one list, so they cannot drift apart. Section ids are permanent
  anchors, like the FAQ ids; FAQ items carry a topic.
- **The repo's copy wins where it is newer than the design** (the scanner
  wording of ADR-030: door staff never see the phone digits). The design's
  new summaries, callouts, About steps and FAQ wording were approved with
  the plan; a review against the code corrected the rest (sign-in stores
  the IP address and browser; the printed backup list also carries ticket
  types and order references; the emails list; a ticket the organizer
  cancels is refunded).
- **The focus ring deviates from the design:** the specified 3 px marigold
  outline is about 2:1 against these light surfaces, under WCAG 1.4.11's
  3:1, so a 2 px charcoal ring fills the outline offset. The design system
  canvas should be updated to match.
- **Print is scoped:** a named `@page help` (16/16/18 mm) and a
  `.help-page` rule (black on white, no tints, links not underlined); the
  admin print sheets keep the default page. The public header and footer
  are hidden in print everywhere.
- Three small client pieces, all progressive enhancements: a scroll-spy
  (`aria-current`), anchors that also copy their URL, and "Print or save as
  PDF". Everything works as plain links without JavaScript.

**Consequences:** A new policy section is a data entry, not markup. Any
promise added to a short version or callout must restate a section below
it. The sticky table of contents is sticky only on viewports at least
44 rem tall (short laptops would hide its last rows).
