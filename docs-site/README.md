# Developer docs

Public content lives only in `content/docs/`. The app's operational docs and
personal notes are outside this collection. See [the design](../docs/systems/DOCS_SITE.md).

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm docs:dev
pnpm docs:verify
pnpm docs:test
```

Development runs at `http://localhost:3001`. `pnpm docs:build` exports to
`docs-site/out/` and checks every internal link, anchor, and referenced asset.
`pnpm --filter @echoandaura/docs preview` serves the export at port 4181.
Browser tests require `pnpm exec playwright install chromium` once locally.
The complete repository gate is `pnpm verify`; CI also runs the docs browser test.

Use `<SourceLink path="src/server/services/orders.service.ts">Order service</SourceLink>`
in MDX. The build validates the file and pins its GitHub link to the checkout's
commit. Uncommitted edits are visible locally but have no remote commit yet.
Do not import application services to render documentation.
Never start a line with an inline `<SourceLink>`: MDX treats it as a block and
Prettier splits the paragraph. Break the line before the tag's sentence instead;
`tests/content.test.ts` checks this.

## Source excerpts and type examples

Use an empty TypeScript fence with `source="src/server/lib/hold.ts#holdLapsed"`.
The build extracts the named function, variable, or `object.method` using the
TypeScript syntax tree. It does not depend on line numbers. Missing or ambiguous
symbols fail the build; copied fence bodies are refused. Only explicitly selected
`src/**/*.ts` files are allowed. Source dependencies are registered with MDX so
edits invalidate the corresponding page. The docs never execute those modules.

For Twoslash, add `twoslash source-module="src/server/lib/order-rules.ts"`
to a fence, import `./order-rules`, and put `// ---cut---` before the visible
illustrative call. The plugin reads the real module into a virtual compiler file
on each compilation. Use only small, self-contained pure modules; dependencies
are not recursively copied. Do not silence compiler errors to publish a sample.
Twoslash 4 uses its native TypeScript 7 dependency for samples; the application
and docs typechecks remain on the existing TypeScript 5.9.3.

The last-ticket component is a deterministic illustration, not a database test.
Keep its assumptions and written equivalent beside it, and link the actual
Postgres integration test. `docs:verify` includes source-plugin failure tests;
`docs:test` covers the walkthrough, type popup, search, and narrow themes.

Dependencies are pinned. The docs use webpack because it is the bundler verified
by the design spike. Generated `.source/`, `.next/`, and `out/` are ignored.
No app `.env` is loaded by these commands.

## Diagrams

Behavior diagrams are Mermaid sources in `diagrams/*.mmd`, rendered ahead of
time to `public/diagrams/<name>.light.svg` and `<name>.dark.svg`:

```sh
pnpm docs:diagrams
```

Commit the sources and both renderings together. Rendering needs the
Playwright Chromium above and the pinned `mermaid` package; nothing is fetched.
`diagrams/config.mjs` holds both themes. Every SVG starts with a stamp that
hashes its source and that config, and `tests/unit/docs-diagrams.test.ts`
fails while any rendering is stale or orphaned. The same test checks that
`order-states.mmd` draws exactly the app's `ORDER_TRANSITIONS`.

In MDX, `<Diagram name="order-states" alt="…">caption</Diagram>` shows the
rendering for the current theme, linked to the full-size file. Write `alt` as
what the picture says in words; use the caption for how to read it.

## Vendor icons

The system map's brand marks are vendored in `lib/vendor-icons.ts`, never
fetched at runtime:

- **Simple Icons 16.33.0** (CC0-1.0): Cloudflare, Cloudflare Pages and
  Workers, PostgreSQL, Redis, Next.js, Node.js, Traefik, GitHub, GitHub
  Actions, Sentry and Better Stack. Each is the `d` of `icons/<slug>.svg`.
- **AWS Architecture Icons** (package 07312026): Amazon S3, drawn unmodified
  (its green tile is part of the mark). AWS permits these icons in
  architecture diagrams; see https://aws.amazon.com/architecture/icons/.

The marks remain their owners' trademarks and imply no endorsement. Show a
service only where it takes part. To add a mark, copy its path from the
same sources and add its source line here.

## Publication (D3A, prepared but not activated)

The export includes a collection-derived sitemap, robots rules and reviewed
Pages `_headers`. `pnpm verify` also runs publication policy/artifact tests.
`DOCS_PREVIEW_MODE=pages pnpm docs:test` runs the browser suite against the
local Pages emulator and checks response headers; it needs no Cloudflare token.
The plain preview remains useful for fast local work.

CI packages only the checked export after its full gates. A separate publisher
uses trusted main-branch code to validate and upload the exact artifact, never
executing PR code with deployment credentials. It stays inactive until the owner
configures protected GitHub environments and `DOCS_PUBLISH_ENABLED=true`.
Forks do not publish. Same-repository previews are public `pr-N` deployments;
noindex is not privacy. Only current green main CI can select production.

The configuration is not evidence of live Pages/DNS/TLS. Follow the staged,
owner-operated [publication guide](../docs/infra/DOCS_PUBLICATION.md).
Application deployment filtering is D3B; the existing app workflow is unchanged.
