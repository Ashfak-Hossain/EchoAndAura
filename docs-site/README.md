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
No app `.env` is loaded by these commands. Deployment is a separate slice.
