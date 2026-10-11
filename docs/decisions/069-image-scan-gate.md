---
id: ADR-069
title: Fail the deploy on critical, fixable vulnerabilities in the images
date: 2026-10-12
status: accepted
area: Infrastructure and deploys
supersedes: []
extends: [ADR-036]
---

# ADR-069 — Fail the deploy on critical, fixable vulnerabilities in the images

**Context:** The web and worker images ship the Node base image and every
production dependency. Nothing checked them for known vulnerabilities. A
first Trivy scan of the running images (2026-10-12) found 2 critical and 64
high fixable findings in the worker, all in files it never runs: esbuild
0.25.12's Go runtime (drizzle-kit, as better-auth's optional peer), the docs
site's native TypeScript compiler, and npm. Those were removed first, leaving
both images with none. In March 2026 (CVE-2026-33634) attackers rewrote the
version tags of Trivy's own GitHub Actions to read secrets from runner
memory, and the deploy's images job holds the registry token and Dokploy's
deploy keys.

**Decision:** The deploy's images job scans both images after building them
and before the smoke test, push or deploy
([deploy.yml](../../.github/workflows/deploy.yml), step "Scan images"):

- **Policy:** fail on any **critical** vulnerability that **has a fix**
  (`--ignore-unfixed`). High ones are listed in the log without failing.
- **Isolation:** Trivy runs as its own container, pinned by digest
  (`TRIVY_IMAGE`; the same digest on Docker Hub and public ECR), reading a
  `docker save` export mounted read-only. No Docker socket and none of the
  job's secrets reach it. No Trivy GitHub Action is used anywhere.
- **Database:** three mirrors in order (Google's, AWS's, GitHub's), so one
  registry outage does not block a deploy.
- **Exceptions:** [.trivyignore.yaml](../../.trivyignore.yaml), by PR only,
  each with a reason and an `expired_at` at most 30 days out; an expired entry
  fails the scan again.

A test ([image-scan.test.ts](../../tests/unit/image-scan.test.ts)) keeps the
order, the policy, the pin and the isolation in place.

**Rejected:** `aquasecurity/trivy-action` or `setup-trivy`, even pinned to a
commit (third-party code inside the job that holds deploy secrets); failing
on high findings (most sit in code that never runs; listed, not blocking);
a separate scan job after pushing (the `main` tag would already point at an
unscanned image); scanning only on a schedule (a vulnerable image could
deploy for days).

**Consequences:** A new critical CVE with a fix in any dependency or the base
image blocks deploys until it is fixed or excepted, so a security advisory
can stop an urgent release. The except-with-expiry path is the escape hatch.
The scan adds about a minute per deploy, plus the database download. The
images are public on GHCR (ADR-041), so the public log reveals nothing an
outsider couldn't scan for themselves. The pinned Trivy is bumped by hand
(DEVELOPMENT.md → Dependencies); the vulnerability database updates itself.

**Revisit when:** Exceptions pile up or the gate blocks releases for findings
that never run; a trustworthy managed scanner (e.g. GHCR's own) covers the
same ground; or Trivy's supply chain is compromised again.
