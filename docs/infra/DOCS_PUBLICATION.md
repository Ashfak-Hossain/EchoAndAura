# Publishing the developer docs

Status: PRODUCTION AND PR PREVIEW VERIFIED · Owner: Evan · Last updated: 2026-10-08

D3A production hosting is active at `docs.echoandaura.com`. The owner applied
both reviewed Terraform stages and confirmed `No changes` afterwards. The
protected production upload and live HTTPS/browser checks passed, including the
first owner-approved same-repository PR preview and the post-merge main upload.
History separates owner-supplied Terraform results from read-only live checks.
Application deployment filtering is D3B2, a separate slice. D3B1 prepares app
revision confirmation (ADR-066), not filtering; a docs merge still triggers an
application deployment. No live D3B1 confirmation is claimed yet.

This is an operational guide, **not part of the public docs-site collection**.
There are no secret values here. Never paste a full Terraform plan, `.env`,
state file, credential screenshot or sign-in code into a PR or chat.

## The two jobs

Terraform prepares the hosting infrastructure. GitHub Actions publishes files.
They use different credentials and cannot substitute for each other.

```text
Reviewed Terraform code → user reviews plan → user applies hosting resources
Checked CI export      → trusted publisher → static files uploaded to Pages
```

Pages serves prebuilt HTML, CSS, browser JavaScript and the static search index.
It has no database, worker, application environment, Functions bindings or build
secrets. Direct Upload does not rebuild the site in Cloudflare. Changing this
project to native Git integration later requires a new Pages project.

## Learn Terraform through this change

Terraform loads **all `.tf` files in one directory as one root module**. Adding
`pages.tf` does not create a separate state file or a separate apply. The existing
Cloudflare module still owns its DNS, Access and zone rules, so review the whole
plan, not just lines containing `docs`.

### 1. Declare the hosting container: `pages.tf`

```hcl
resource "cloudflare_pages_project" "docs" {
  account_id        = var.cloudflare_account_id
  name              = "echoandaura-docs"
  production_branch = "main"

  lifecycle {
    prevent_destroy = true
  }
}
```

- `cloudflare_pages_project` is the provider's resource type.
- `docs` is Terraform's local label. Its state address is
  `cloudflare_pages_project.docs`; it is not the website's hostname.
- `name` is the actual Cloudflare project name. The uploader must name the same
  project. Renaming the local label without a `moved` block can look like a
  deletion and creation; renaming the real project can also require replacement.
- `var.cloudflare_account_id` reads the existing private local configuration.
  There is no hardcoded account identifier or API token in this change.
- `production_branch = "main"` makes uploads explicitly marked `main` production.
  Our own `pr-N` branch names select previews, even when a PR branch is named main.
- No `source` block means Direct Upload. CI, not Cloudflare, does the build.
- `prevent_destroy` makes Terraform refuse a planned deletion while this
  resource declaration remains present. It is a guard, not a backup or an
  account-wide deletion lock; deleting the declaration removes that guard too.

We are creating a new resource, **not importing an existing one**. If a project
already exists under this name, stop and review ownership before importing it.

### 2. Attach the hostname: `pages.tf` and `dns.tf`

`cloudflare_pages_domain.docs[0]` tells Pages that this project owns the custom
hostname. `cloudflare_dns_record.cname_docs[0]` sends traffic there. These are
different resources: the pinned provider's domain API does **not** create DNS.

The DNS `content` references `cloudflare_pages_project.docs.subdomain`. This is
a computed provider value, rather than a duplicated hostname string. Terraform
learns it after project creation. `depends_on = [cloudflare_pages_domain.docs]`
also tells Terraform to associate the hostname before creating its CNAME. A
CNAME alone, without the Pages association, can return HTTP 522.

`ttl = 1` means automatic; `proxied = true` keeps this record behind Cloudflare.
Only the new docs record is added. Existing app, deploy, media and mail records
are not edited or adopted by this slice.

### 3. Stage the connection: `variables.tf`

`docs_custom_domain_enabled` defaults to `false`. The domain and DNS resources
use `count = var.docs_custom_domain_enabled ? 1 : 0`: zero before attachment,
one afterwards. Hence the `[0]` in their state addresses.

This allows two reviewed applies with a tested upload between them. Once
attached, keep the variable true in local configuration. It is **not** a kill
switch: setting it false requests removal, which the destruction guards refuse.
Rollback uses Pages deployments, not deleting DNS or Terraform state.

### 4. Keep the VPS rate limit focused: `rules.tf`

The existing rate limit is zone-wide. Add only
`http.host ne "docs.echoandaura.com"` to its expression. Static docs live on
Pages, not the VPS whose capacity this rule protects. All other hosts retain
the same rule, stable `ref`, 150-request/10-second budget and block duration.

This is **one in-place change** to the existing rate-limit ruleset. It is not
an all-new-resources plan. Do not change its `ref`, other rules or thresholds.

## Plan expectations and confirmed rollout

| Stage                          | Intended resources                                                                  | Expected summary if there is no unrelated drift |
| ------------------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------- |
| A: project, hostname disabled  | Create `cloudflare_pages_project.docs`; update only `cloudflare_ruleset.rate_limit` | `1 to add, 1 to change, 0 to destroy`           |
| B: after a checked main upload | Create `cloudflare_pages_domain.docs[0]` and `cloudflare_dns_record.cname_docs[0]`  | `2 to add, 0 to change, 0 to destroy`           |
| After either approved apply    | Compare code and live resources again                                               | `No changes`                                    |

These remain review expectations for a new setup, not instructions to repeat
the completed rollout. Both stage summaries and final `No changes` plans were
confirmed by the owner; see History. Provider defaults or unrelated drift can
differ on a later run. Stop for any unexpected resource, deletion, replacement or
unexplained change. Never use `-target` to hide unrelated changes from review.
`prevent_destroy` does not prevent a harmful in-place change; read every diff.

## Credentials: names and locations only

The local Terraform token stays in Bitwarden and the ignored laptop `.env`.
The owner adds **Account → Cloudflare Pages → Edit** for the intended account
to its existing permissions before planning this change. Do not copy this
broad Terraform token into GitHub.

The owner creates separate Pages-only upload tokens outside Terraform and
stores them in Bitwarden and the appropriate GitHub **environment secrets**:

| Environment       | Secret name                  | Purpose                                                                        |
| ----------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| `docs-production` | `CLOUDFLARE_PAGES_API_TOKEN` | Production upload; Account → Cloudflare Pages → Edit only                      |
| `docs-preview`    | `CLOUDFLARE_PAGES_API_TOKEN` | Preview upload; separate token with the same Pages-only permission             |
| Both              | `CLOUDFLARE_ACCOUNT_ID`      | Intended account identifier; keep it out of public logs and repo configuration |

Pages tokens are **account-scoped, not project-scoped**. They can modify other
Pages projects in that account. Environment approval, isolated upload tooling
and static-artifact validation reduce exposure; they do not shrink that API
permission. Do not grant DNS, WAF, Access, R2, email, AWS or Dokploy privileges.
No token is created by Terraform or stored as a resource attribute. Terraform
state and saved plans still contain private infrastructure metadata; keep them
private even without secret resources. `sensitive = true` hides display, not
the value from state.

Set deployment protection to the default branch for both GitHub environments;
the publisher itself runs on main. Require a reviewer for previews, and for
initial production activation. Do not move these tokens into repository-wide
secrets or into the unprivileged CI workflow. Confirm protection availability
in the repository's GitHub settings before enabling publication.

### Confirmed GitHub setup

Read-only GitHub checks on 2026-10-08 confirmed:

- Both `docs-production` and `docs-preview` allow only the exact `main` branch,
  require the owner as reviewer, allow self-review for this solo-owner workflow,
  and prevent administrators from bypassing protection. The publisher runs on
  trusted main code even when selecting a PR artifact.
- Both environments contain secret names `CLOUDFLARE_PAGES_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID`. Values were not retrieved. The production credential
  worked for the first upload; presence alone does not prove the preview token.
- Repository variable `DOCS_PUBLISH_ENABLED` is `true`.

The owner created separately named production and preview Pages tokens.
Bitwarden storage and their exact expiry dates were not independently confirmed;
do not mark them verified or copy values into the inventory.

## Publication checks and limitations

CI packages only `docs-site/out` after verification, browser tests and real
Postgres integration tests. Artifacts include run ID, attempt, head revision,
build revision and file hashes. The manifest is a consistency check, **not an
independent signature**: trust comes from fetching the exact artifact from the
verified GitHub CI run and from the protected workflow/code on main.

The separate publisher checks the CI workflow path, repository, event,
successful completion, run attempt, artifact identity and current main/open-PR
revision. Forks, closed PRs, outdated heads and failed runs are not published.
It checks again after environment approval. Production always uses `main`;
same-repository PRs always use `pr-N`. Preview URLs are in the upload log; the
workflow does not post PR comments or get repository write permissions.

The publisher checks out trusted default-branch code, never the PR revision.
It never executes artifact scripts, installs artifact packages or uses their
configuration. It refuses links, dotfiles, raw source/maps, Pages Functions,
Worker/routing/redirect configuration and changed hosting headers. Common
credential markers fail the upload without printing the content. This is not
a complete secret detector: opaque token values cannot all be recognized.
Review intentionally authored public pages and source excerpts before merging.

Only the final upload step receives Cloudflare credentials. The uploader is
installed separately first; no application credentials are available to it.
Before uploading, a read-only API check requires the existing Terraform-created
Direct Upload project, production branch main, and no project environment
secrets or runtime bindings. Missing/wrong hosting stops the job; the uploader
must not create a project or redirect publication to Workers. Previews that
change `_headers` are refused until the reviewed header policy is on main.
Upload failures fail the job. Publication is serialized and stale runs are
rechecked; GitHub and Cloudflare have no shared atomic transaction, so a new
commit arriving during an upload is handled by its following checked CI run.

Previews are **public**, not a place for private notes or production details.
`noindex` headers discourage search indexing on all pages.dev URLs, but do not
restrict access. The production sitemap names only public collection pages.
Pages applies `_headers` to the static responses. The CSP restricts framing,
objects and base URLs; it is not the application's nonce-based script policy.
Static Next hydration uses inline scripts, so no unsupported nonce policy is
claimed. Keep the top-level `404.html`: without it, Pages can behave like an SPA.

## Activation sequence: one reviewed round at a time

Do not run this entire list as a script. The owner performs changes, then we
verify the non-secret result before the next round.

1. Review the PR and local checks. Confirm there is no existing Pages project
   or DNS record with the intended names. Configure the local token's Pages
   permission; do not share its value. Leave `DOCS_PUBLISH_ENABLED` unset.
2. Run **only** `pnpm tf:cloudflare plan`. Stage A should have the exact
   resources above. Share only its summary and resource addresses, redacting
   account identifiers, emails and any unrelated private information. Do not
   save or post the full plan. Sign in to AWS separately if state access expired.
3. After review, the owner applies Stage A and runs another plan. Require
   `No changes`. Record verified resources, not merely a successful request.
4. Merge reviewed code, configure both protected GitHub environments and their
   secrets, and set repository variable `DOCS_PUBLISH_ENABLED` to `true`. If the
   latest current main CI already succeeded while publishing was disabled,
   re-run its corresponding skipped **Publish docs** run, not CI. Leave debug
   logging off and approve only `docs-production` after checking the selection.
   Re-running main CI can also trigger the unchanged application Deploy workflow.
   The source CI attempt must still match and its checked artifact must exist
   and be unexpired; otherwise stop and review a new CI run separately.
   First test the default `echoandaura-docs.pages.dev` production deployment:
   HTTPS, pages, search,
   links, themes, mobile layout, headers, missing-page HTTP 404 and noindex.
5. Only after that works, set local `TF_VAR_docs_custom_domain_enabled=true`
   yourself. Review Stage B's plan separately, then apply after approval.
   Wait for domain/certificate activation; do not point DNS at a different host
   or turn off validation to hurry it. If an existing record conflicts, stop
   and resolve ownership instead of deleting it.
6. Verify HTTPS at `docs.echoandaura.com`, its Pages association, DNS target,
   search, direct routes, sitemap, headers and a real 404. Run another Terraform
   plan and require `No changes`. Check a same-repository PR preview separately;
   it must not replace the custom production hostname or receive app credentials.
7. Update this History, [CLOUDFLARE.md](CLOUDFLARE.md),
   [TERRAFORM.md](TERRAFORM.md) and the secret inventory with confirmed changes
   and names/locations only. Never copy the secret values into those records.

## Failure and rollback

Missing credentials, validation errors, expired artifacts and failed CI should
stop publication. A Pages upload is not proof that the custom hostname works.
Inspect the deployment and verify the live site before declaring it published.
Certificate errors may need CAA/domain validation review; do not weaken app TLS.

For a bad production publication, disable the Publish docs workflow and cancel
pending uploads first, then use Pages' rollback to an earlier successful
**production** deployment. A preview cannot be its rollback target. Fix forward
on a branch, run CI, and re-enable the publisher after review. Do not destroy the
project, remove DNS or edit state to roll back content. Tokens suspected of
exposure must be revoked/rotated in the dashboard, not printed for diagnosis.

## Verification

- `pnpm verify`: full application gate, docs build/source checks, publication
  policy/artifact tests and workflow contract tests.
- `pnpm docs:test`: file-server navigation/search/mobile/theme/404 and metadata.
- `DOCS_PREVIEW_MODE=pages pnpm docs:test`: the same browser checks on the local
  Pages emulator, plus response headers. This is not live DNS/TLS verification.
- Terraform format, credential-free validation and lint. A live plan/apply is
  a separate owner-operated gate; it is not performed by CI.

## Official references

- [Provider 5.26.0: Pages project](https://github.com/cloudflare/terraform-provider-cloudflare/blob/v5.26.0/docs/resources/pages_project.md)
- [Provider 5.26.0: Pages domain, including DNS ownership](https://github.com/cloudflare/terraform-provider-cloudflare/blob/v5.26.0/docs/resources/pages_domain.md)
- [Cloudflare Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)
- [Direct Upload from CI and token permission](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)
- [Custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)
- [Static headers](https://developers.cloudflare.com/pages/configuration/headers/)
- [Preview deployments](https://developers.cloudflare.com/pages/configuration/preview-deployments/)
- [Rollbacks](https://developers.cloudflare.com/pages/configuration/rollbacks/)
- [GitHub workflow reruns](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs)
- [GitHub deployment reviews](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments)

## History

### Production rollout confirmed on 2026-10-08

- **Terraform, owner-supplied evidence:** Stage A reviewed as `1 to add, 1 to
change, 0 to destroy`: create the Pages project and narrowly exclude the docs
  host from the existing rate limit. Stage B reviewed as `2 to add, 0 to change,
0 to destroy`: `cloudflare_pages_domain.docs[0]` and
  `cloudflare_dns_record.cname_docs[0]`. The owner applied both stages and
  explicitly confirmed a fresh `No changes` plan after each. Plans and applies
  remained owner-operated; these Terraform results were not independently
  reproduced.
- **Hosting check:** a read-only Cloudflare check validated the existing static
  Direct Upload project `echoandaura-docs`, production branch `main`, and no
  project environment secrets or runtime bindings before the first upload.
- **Production upload:** [Publish docs run 37612098200, attempt 2](https://github.com/Ashfak-Hossain/EchoAndAura/actions/runs/37612098200)
  succeeded at main revision `6ed6799`, using the checked artifact from
  [CI run 37611573321, attempt 1](https://github.com/Ashfak-Hossain/EchoAndAura/actions/runs/37611573321).
  Only the publisher was re-run; the owner approved `docs-production`.
- **Live checks:** valid HTTPS, direct routes, static search, source links,
  robots/sitemap, expected security headers and real missing-page HTTP 404
  passed on both `echoandaura-docs.pages.dev` and `docs.echoandaura.com`.
  Pages-hosted addresses have `noindex`; the custom production hostname does not.
  This describes the indexing policy, not proof that a search engine indexed it.
- **Browser and link checks:** all five existing browser tests passed against
  each live hostname, with no skips. Search/focus, type popovers, the last-ticket
  walkthrough, light/dark themes and 320/390px layouts worked. Each hostname's
  crawl checked six public pages and 180 internal links/assets, including anchors.
  A proxied DNS record need not expose its raw CNAME publicly; the final
  owner-confirmed provider-refresh plan establishes configuration consistency.

### Preview and post-merge upload confirmed on 2026-10-08

PR #71's owner-approved preview publisher [run 37675528133](https://github.com/Ashfak-Hossain/EchoAndAura/actions/runs/37675528133)
succeeded. Non-secret uploader metadata confirmed `pr-71` at PR revision
`b22c4b3`, rather than mistaking the trusted-main workflow SHA for its artifact.
All five existing browser tests passed on the preview without skips; six public
pages and 180 internal links/assets passed. HTTPS, search, themes, narrow
layouts, metadata, headers and real 404 behavior worked; preview remained
`noindex` and production remained healthy.

After PR #71 merged as `94a6d5c`, the owner approved `docs-production`.
[Publisher run 37676563915](https://github.com/Ashfak-Hossain/EchoAndAura/actions/runs/37676563915)
and all validation/recheck/upload steps succeeded, with no pending approvals.
Fresh production browser checks passed all five tests, six pages and 180 links.
HTTPS/header/indexing checks passed on production, default Pages and preview;
internal-only operational/local-note paths returned 404. The custom production
hostname has no `noindex` header; both Pages addresses do. No secret values were
retrieved. New Bitwarden entries and exact token expiries remain unconfirmed.

D3A hosting/publication validation is complete. D3B1 confirmation is prepared
separately; D3B2 application deployment filtering is still unimplemented.
