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
Do not import application services to render documentation. Selected source
excerpts and Twoslash arrive with the tour slice.

Dependencies are pinned. The docs use webpack because it is the bundler verified
by the design spike. Generated `.source/`, `.next/`, and `out/` are ignored.
No app `.env` is loaded by these commands. Deployment is a separate slice.
