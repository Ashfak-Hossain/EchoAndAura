# Developer documentation site

Status: DRAFT · Owner: Evan · Last updated: 2026-10-07

The design for `docs.echoandaura.com`: a place to understand how Echo & Aura
works, follow the implementation, and find a precise answer when returning
to the project. The foundation is clear reference documentation. Selected
concepts add diagrams and interactive explanations.

The product direction is agreed. The visual treatment is a prototype for
review; the site has not been published. [ADR-064](../decisions/064-developer-docs-site.md)
records the architectural boundaries. This document describes the experience,
the technical spike, and the implementation slices.

## Who it serves

Two readers use the same content differently:

- **Learning the system:** a developer wants to see an order travel through
  the application and understand the reasons behind its design.
- **Working with the system:** a developer needs the behavior of a service,
  the relevant source and tests, or the decision behind an unfamiliar rule.

The writing assumes basic TypeScript and web knowledge. Explain project
concepts before naming their implementation. Define terms such as reservation,
transaction, idempotence, and after-commit work at their first meaningful use.
Link deeper explanations so experienced readers can continue without a detour.

The repository remains proprietary under its existing license. This is a
public learning resource; publishing it does not grant contribution or reuse
rights beyond that license.

## Reading paths

| Section        | The reader's question                          | First useful pages                                                        |
| -------------- | ---------------------------------------------- | ------------------------------------------------------------------------- |
| Start here     | What is this system, and where should I begin? | System overview; reading the codebase; local learning setup               |
| Tours          | What happens through a complete feature?       | Buy a ticket; later, admit a guest at the gate                            |
| Concepts       | Why does this mechanism work?                  | Atomic inventory; integer money; after-commit jobs; idempotent operations |
| Reference      | Where is the exact behavior defined?           | Order states; service boundaries; queue jobs; relevant types and tests    |
| Decisions      | Why was this approach chosen?                  | Curated explanations linked to canonical ADRs                             |
| Infrastructure | How are the pieces connected?                  | Public system topology; delivery pipeline; infrastructure ownership       |

Each published section must contain useful content. Keep unbuilt sections out
of navigation rather than filling them with empty pages. Search indexes only
the content that the site intentionally publishes.

### A learning page

1. State the question and the outcome in a short introduction.
2. Show a small diagram of the relevant pieces.
3. Walk through a concrete example using the application's actual rules.
4. Include a short source excerpt and link to the full implementation.
5. Explain a failure or race and link to the test that checks it.
6. Link the decision and one logical next page.

An interaction belongs between steps 3 and 5 when timing, competing actions,
or changing state is hard to understand from prose. The written explanation
must remain useful without operating the interaction.

### A reference page

Lead with the contract: inputs, outputs, state changes, and failure behavior.
Use tables when readers compare cases. Give direct source and test links,
then link back to a concept or tour for the explanation. Do not require a
reader to replay a tutorial to find an error condition.

## The first tour: Buy a ticket

Follow one order across the real boundaries:

| Stage    | What the reader learns                                                              | Evidence to connect                                   |
| -------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Register | Validate input and calculate the price on the server                                | Registration action; order service; pricing tests     |
| Reserve  | Hold stock with a conditional UPDATE, together with the order and audit row         | Inventory repository; concurrency test; ADR-011       |
| Pay      | The buyer transfers money outside the application and submits a transaction ID      | Payment submission; uniqueness constraint; ADR-013    |
| Verify   | An admin checks the payment statement and approves or rejects it                    | Fulfilment service; approval race tests; ADR-014      |
| Issue    | Approval converts reserved inventory to sold and creates tickets in the transaction | Fulfilment repository calls; ticket tests             |
| Deliver  | After-commit work queues the email for the worker                                   | Queue producer; dispatcher; delivery failure behavior |

Use invented people and data. A diagram must distinguish a database transaction
from a network request and an asynchronous job. Manual bKash payment must never
look like a payment API call. Describe expiry only for an unpaid hold; a
submitted payment awaits the admin's decision.

The first interactive concept is **two buyers racing for the last ticket**.
Provide Next, Previous, and Reset controls. Show the pending request, held row,
commit, and refused second reservation. Either buyer can win in production;
the initial prototype illustrates one possible interleaving. The animation is
an explanation, while the linked real-Postgres test is the evidence.

Later candidates are rollback after a failed insert, queue retries, and the
online/offline gate flow. Build one at a time when a page needs it.

## Visual direction

Use a restrained documentation shell: readable text, generous spacing, a
stable sidebar, an on-page contents list, keyboard search, and clear links.
Borrow the application's warm accent for navigation without copying its
ticket-buying layout. Both light and dark themes are first-class.

Color is strongest inside diagrams and explanatory components. Use a small
semantic palette consistently: blue for a visitor/request, violet for
application coordination, teal for stored state, amber for queued/waiting
work, and rose for delivery or external work. Labels and shapes carry meaning
as well, so understanding never depends on color alone. Preserve recognizable
brand colors within product icons.

### Choose the diagram tool for the question

| Diagram                                       | Starting approach                                   | What must remain easy to maintain                                |
| --------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| Sequence, state machine, small flow           | Styled Mermaid                                      | Text source, meaningful labels, reviewable changes               |
| Architecture overview with product icons      | Editable SVG illustration, with draw.io a candidate | Source file, icon provenance, boundaries and connector placement |
| Architecture with frequent structural changes | Evaluate D2 if Mermaid becomes awkward              | Reproducible export and an understandable diff                   |
| Step-controlled explanation                   | Small React component inside MDX                    | Deterministic states, keyboard controls, written equivalent      |

Mermaid is a default for behavior diagrams, not a requirement for every
visual. The poster authoring tool remains open until the same representative
architecture has been compared visually. Avoid adopting a second diagram
compiler just to draw one image.

Use official AWS architecture assets for AWS services, and appropriate vendor
assets for Cloudflare, Postgres, Redis, and other products. Show services only
where they actually participate. For example, S3 belongs in the backup view;
its icon does not imply the web application runs on AWS. Record the source
and applicable usage terms for each vendored asset. The prototype's Logos
icon pack demonstrates presentation, not final asset selection.

Keep diagram source and published output together. Prefer build-time SVG
exports for static diagrams so readers receive a complete image immediately.
Support enlarging dense diagrams, a visible caption, and a text explanation.
Check connectors, labels, contrast, and cropping in both themes and on phones.
A phone should offer a readable overview and an enlarged view, rather than
shrinking a whole infrastructure poster into unreadable text.

Motion is user-controlled. Honor reduced-motion preferences; do not autoplay
requests or use continuous animation behind the text. Every interactive
control needs a useful accessible name, focus state, and keyboard behavior.

## Content and source stay connected

The implementation will live in a separate `docs-site/` package in the pnpm
workspace. Author public content in its own MDX directory. Existing operational
documents remain in their current repository locations.

- Include selected source text at build time. Do not execute application
  services or import the composition root to display a snippet.
- Resolve source links against the exact commit used for the docs build, with
  line anchors where appropriate. Show the revision on source-heavy pages.
- Validate referenced files and regions during the build. A moved or removed
  excerpt must fail visibly, rather than silently displaying old code.
- Use Twoslash for focused TypeScript explanations where type information
  helps. Label illustrative code separately from extracted application code.
- Keep tests and ADRs one click from the explanation they support.
- Publish curated decision stories with links to the original ADRs. Do not
  copy all historical records into a second independently edited collection.

Public content is explicitly selected. Do not glob the whole `docs/` or
`notes/` directory into MDX, search, downloadable Markdown, or an LLM index.
Exclude production runbooks, server addresses, account records, environment
values, credentials, real buyer data, and operational screenshots. The
GitHub-only publication boundary is editorial; it does not make files in a
public repository private.

## Static site architecture

Use Fumadocs UI and MDX with Next.js static export. Build the HTML, assets,
and search index in CI. Cloudflare Pages serves the resulting `out/` files
at `docs.echoandaura.com`. Interactive teaching components run locally in the
reader's browser and need no application database or production credentials.

Search uses Fumadocs' static client and exported index. Load it on demand and
measure its size as content grows. A hosted search provider is a future option
if the download becomes unreasonable; it is unnecessary for the first pages.

Cloudflare now recommends Workers for new general applications, while its
Pages guide still supports Next.js static exports. Pages remains the agreed
target for this static site. Revisit hosting if a future feature requires a
server; do not quietly add such a dependency to a learning widget.

### Integration with this repository

The skeleton slice must account for the existing root configuration:

- `pnpm-workspace.yaml` currently has build policies and overrides but no
  package list. Add the docs package while preserving those policies.
- Root TypeScript includes `**/*.ts` and `**/*.tsx`. Exclude `docs-site/`
  from the application's check and give the docs package its own check.
- Scope linting, generated-file ignores, and formatting to both packages.
  Generated `.source/`, `.next/`, and `out/` content must not enter Git.
- Pin direct dependencies exactly and commit the shared lockfile. Keep the
  root application's Next.js/React versions stable during the docs slice.
- Keep `pnpm verify` the complete local quality gate once the docs package
  lands. Add docs verification explicitly; avoid accidental recursive builds.
- Run docs build/link checks in PRs. Review deployment path filters so a
  documentation-only change does not needlessly redeploy the ticketing app.
- Provision Pages and the docs DNS record through the project's infrastructure
  workflow. Production changes remain person-applied after review.

Do not load the application's `.env` for a docs build. The first site needs
only public build metadata, such as its URL and source revision.

## Technical spike

The isolated experiment uses the application's Next.js 16.3.8, React 19.3.0,
Tailwind 4.3.3, TypeScript 5.9.3, and pnpm 11.9.0. Packages checked on
2026-10-07: Fumadocs Core/UI 16.16.2, MDX 15.4.6, and Twoslash 4.0.1.
These are tested candidates for the skeleton, not a request to upgrade the
application. Mermaid candidates are CLI 12.0.0 and Mermaid 12.1.0.

The prototype contains a landing page, an architecture page, and a last-ticket
concept page. It exercises a real Fumadocs sidebar, static search, Twoslash,
source inclusion, themed visuals, product icon presentation, and a React
walkthrough. It lives outside the application; no site package is shipped by
this design slice.

The static build and type check passed using webpack, including the Twoslash
example, a real `order-rules.ts` source include, and the exported search route.
Browser checks passed for navigation, static search, all walkthrough steps and
reset, emitted Twoslash markup, dark theme, and no document overflow at 390px
and 320px. No browser page errors were recorded. Desktop and mobile screenshots
were inspected. The two-page search export is 39,822 bytes uncompressed; this
is not a representative full-site performance measurement.

Mermaid SVGs were rendered in both themes and visually reviewed; the dark
export needed an explicit dark theme to make connector labels readable.
Full accessibility and screen-reader audits, final vendor assets, and Pages
deployment remain unverified. The prototype is local, not a deployed site.
The webpack build emitted upstream MDX cache-dependency warnings. A clean CI
build and rebuild after source edits remain acceptance checks for the skeleton.
The normal Turbopack build has not yet been established by this spike.

The current Twoslash documentation describes a native TypeScript 7 compiler.
Passing one standalone example alongside the application's TypeScript 5.9
does not establish compatibility for every application import. Keep the
compiler boundary visible and test representative project types before
depending on them in a tour.

## Delivery slices

### Foundation implementation (D1)

`docs-site/` now contains the Fumadocs foundation: a landing page, a substantive
system overview, a code-reading guide, static search, and themed architecture
cards. Source links validate local files and use the checkout's commit. The
public collection is only `docs-site/content/docs/`.

`pnpm docs:dev` starts the docs on port 3001. `pnpm verify` includes docs type
checking, a static export, and checks for internal links, anchors, and assets.
CI also runs the docs browser test. Search loads on demand and explicitly
restores focus when closed. Generated files are ignored by Git, linting,
formatting, and the app's Docker build context. Docker dependency stages copy
the docs manifest to keep workspace installs consistent with the lockfile.

The existing production workflow deploys after every successful CI push to
main. It has no docs-only path filter. Changing this needs a reliable comparison
with the last deployed revision, rather than just the last commit; address it
with the publication slice. D1 does not change production deployment behavior.

Local validation: the full `pnpm verify` passed. Browser checks cover direct
navigation, search results and empty results, focus restoration, dark theme,
320px/390px layouts, the real 404, and browser errors. Light, dark, and mobile
screenshots are generated under the ignored `docs-site/test-results/`.

### First learning journey (D2)

The Buy a ticket tour now connects registration, manual payment, atomic approval,
and after-commit email delivery. A supporting order-state reference distinguishes
the intermediate `paid` audit step from committed `issued` state, and delivery
failures from transaction failures. The last-ticket concept has a user-controlled
four-step model with either buyer winning, reset, and keyboard controls. Its
written explanation and source/test links remain the evidence, not the simulation.

Selected source excerpts are extracted by symbol with the TypeScript syntax tree,
not copied or pinned to line ranges. Missing/ambiguous symbols and invalid fences
fail the build. MDX tracks source dependencies for invalidation. The quantity
teaching sample compiles the real pure module as a virtual Twoslash file without
executing application code. See [authoring conventions](../../docs-site/README.md).
Twoslash's native TypeScript 7 is limited to teaching samples; the application's
existing TypeScript 5.9.3 toolchain is unchanged.

The colorful journey cards and race states work in light/dark themes. The
icon-rich infrastructure poster choice remains open; this slice does not publish
the site or change production infrastructure. Local verification covers six
source-plugin tests, three browser tests, and the full repository quality gate.

| Slice                | Deliverable                                                                                    | Completion evidence                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| D0: design and spike | This design, ADR-064, a local prototype, and recorded findings                                 | Reviewable visuals and explicit tested/unverified boundaries               |
| D1: site foundation  | `docs-site/`, navigation, theme, search, source-link conventions, one substantive overview, CI | Static export, links, keyboard/mobile checks, `pnpm verify`                |
| D2: first tour       | Buy a ticket, supporting reference, and the last-ticket interaction                            | Source/test links verified; prose, visuals, and behavior reviewed together |
| D3: publication      | Pages project, custom domain, previews, deployment configuration                               | Reviewed infrastructure plan, person-applied change, live read-only checks |
| Following slices     | One useful concept, reference page, or tour extension at a time                                | Same content and build checks                                              |

Publication can follow D1 if its overview is ready to share; D2 is the first
complete learning journey. There is no dependency on the deferred restore
drill or on tagging the application `v1.0.0`.

## Review the experience before expanding it

The next visual review should answer three questions: is the main text pleasant
to read, does the colorful architecture remain clear at phone size, and does
stepping through the race explain more than the written example alone?

For the shipped foundation, verify direct page loading and a real 404, search
results and empty results, code copying and source links, keyboard navigation,
focus after closing overlays, both themes, reduced motion, and 320px/390px
layouts. Check the exported HTML and search index for unintended content.

No public site is complete merely because its framework builds. The first
tour needs technical review against the actual implementation and an editorial
pass for explanations, terminology, and the next reading step.

## Sources checked for the spike

- [Fumadocs static builds](https://www.fumadocs.dev/docs/deploying/static)
- [Fumadocs MDX and Next.js](https://www.fumadocs.dev/docs/mdx/next)
- [Fumadocs source inclusion](https://www.fumadocs.dev/docs/mdx/include)
- [Fumadocs static search](https://www.fumadocs.dev/docs/headless/search/orama)
- [Fumadocs Twoslash](https://www.fumadocs.dev/docs/markdown/twoslash)
- [Mermaid architecture diagrams](https://mermaid.js.org/syntax/architecture)
- [Mermaid flowcharts and icons](https://mermaid.js.org/syntax/flowchart.html)
- [AWS architecture assets](https://aws.amazon.com/architecture/icons/)
- [draw.io AWS diagrams and export](https://www.drawio.com/docs/diagram-types/aws-diagrams/)
- [D2 icons](https://icons.d2lang.com/)
- [Next.js static export on Cloudflare Pages](https://developers.cloudflare.com/pages/framework-guides/nextjs/deploy-a-static-nextjs-site/)
- [Cloudflare platform guidance](https://developers.cloudflare.com/pages/framework-guides/)

The installed Next.js 16.3.8 static-export guide was also checked. Its static
GET-route requirement is reflected in the prototype's `force-static` search
route. Versioned package types and an actual build take precedence over older
examples on the web.
