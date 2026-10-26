# syntax=docker/dockerfile:1.10
#
# ADR-036: two production images from one build.
#   web    — the Next.js standalone server (the site, /admin, /door)
#   worker — the BullMQ worker, plus the ops scripts (migrate, create-admin)
#
# Built by GitHub Actions (.github/workflows/deploy.yml), never on the VPS:
# a Next build needs more RAM and disk than the server should give it.
#
#   docker build --target web    --build-arg SOURCE_REVISION="$(git rev-parse HEAD)" --build-arg R2_PUBLIC_URL=https://… -t echoandaura-web .
#   docker build --target worker --build-arg SOURCE_REVISION="$(git rev-parse HEAD)" --build-arg R2_PUBLIC_URL=https://… -t echoandaura-worker .
#
# Both targets need SOURCE_REVISION (the full Git commit) and the URL: they share the build stage, which runs
# `next build`, and the same value lets the second build reuse the first's.
#
# No secret is ever baked in. R2_PUBLIC_URL is public (every cover URL starts
# with it) and must be known at build time: Next bakes the image optimizer's
# allow-list into the build (ADR-033).

# ADR-081: literal FROM references let Dependabot update both Dockerfiles
# together. Keep both production stages and the dev image on this digest.
FROM node:26.12.1-trixie-slim@sha256:36793bcbb160a6a16cede1e62b93f84e26b78a972a8a4c0b879c1c12f22761ec AS base
# Node 25+ ships without corepack. pnpm has no dependencies, so its registry
# tarball is the whole tool: ADD checks its sha256 before anything runs it
# (ADR-084); a global npm install cannot be pinned by hash. Keep this block the
# same in both Dockerfiles and the version equal to package.json's
# packageManager (devcontainer.test.ts, runtime-images.test.ts).
ADD --checksum=sha256:2b567aa66026238078ac2e0a33bec3febd60e962987aac697456f3180819b287 \
  https://registry.npmjs.org/pnpm/-/pnpm-11.9.0.tgz /tmp/pnpm.tgz
RUN mkdir -p /usr/local/lib/node_modules/pnpm \
  && tar -xzf /tmp/pnpm.tgz -C /usr/local/lib/node_modules/pnpm --strip-components=1 --no-same-owner \
  && ln -s ../lib/node_modules/pnpm/bin/pnpm.mjs /usr/local/bin/pnpm \
  && ln -s ../lib/node_modules/pnpm/bin/pnpx.mjs /usr/local/bin/pnpx \
  && ln -s ../lib/node_modules/pnpm/bin/pnpm.mjs /usr/local/bin/pn \
  && ln -s ../lib/node_modules/pnpm/bin/pnpx.mjs /usr/local/bin/pnx \
  && rm /tmp/pnpm.tgz
ENV PNPM_HOME=/pnpm NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ---- every dependency, for the build -------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY docs-site/package.json ./docs-site/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store && \
  pnpm install --frozen-lockfile

# ---- runtime dependencies only, for the worker ---------------------------
# Only the app's own: an unfiltered workspace install also brought the docs
# site's packages (Fumadocs, Twoslash's native TypeScript compiler) into the
# worker image, with critical findings in binaries it never runs (9.9).
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY docs-site/package.json ./docs-site/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store && \
  pnpm install --frozen-lockfile --prod --filter echoandaura

# ---- build ---------------------------------------------------------------
FROM deps AS build
# The slim image has no system CA store. Node carries its own, but the Sentry
# CLI (source-map upload, ADR-068) needs /etc/ssl/certs or TLS fails with curl
# error 60. Build stage only: the runtime images reach Sentry through Node.
# Not version-pinned on purpose: the trust store must stay current, and
# Debian drops superseded versions from its mirrors.
RUN apt-get update && \
  apt-get install -y --no-install-recommends ca-certificates && \
  rm -rf /var/lib/apt/lists/*
COPY . .
ARG R2_PUBLIC_URL
ARG SOURCE_REVISION
ARG NEXT_PUBLIC_SENTRY_DSN
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ARG SENTRY_BUILD_SOURCEMAPS=0
# Image-owned, root-readable metadata: runtime variables cannot claim a new revision.
RUN node -e "const revision=process.env.SOURCE_REVISION; if(!/^[a-f0-9]{40}$/.test(revision)) throw new Error('SOURCE_REVISION must be a full Git commit'); require('node:fs').writeFileSync('deployment-revision.json', JSON.stringify({ revision }));"
# APP_ENV=production makes a missing R2_PUBLIC_URL fail the build here,
# instead of a site whose covers never load (src/lib/image-config.ts).
ENV NEXT_OUTPUT=standalone APP_ENV=production R2_PUBLIC_URL=${R2_PUBLIC_URL}
ENV NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN} NEXT_PUBLIC_SOURCE_REVISION=${SOURCE_REVISION} \
  SENTRY_ORG=${SENTRY_ORG} SENTRY_PROJECT=${SENTRY_PROJECT} SENTRY_BUILD_SOURCEMAPS=${SENTRY_BUILD_SOURCEMAPS}
# `next build` loads every route to read its config, and the database and
# auth modules refuse to load without their settings (fail fast at boot).
# Nothing connects or signs at build time — every page renders per request —
# so placeholders that go nowhere are enough. Build stage only: the web and
# worker images never see them; production sets the real values at runtime.
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:1/not-a-database \
  BETTER_AUTH_URL=https://build-placeholder.invalid \
  BETTER_AUTH_SECRET=build-placeholder-never-used-at-runtime-0000000000
# ...and proven not to have leaked into anything that ships: a page
# prerendered with the placeholder origin would point people nowhere.
RUN --mount=type=secret,id=sentry_auth_token,env=SENTRY_AUTH_TOKEN \
  pnpm build && pnpm worker:build && pnpm ops:build && \
  node scripts/error-tracking-build.mjs finish-image && \
  { find public/vendor -name 'zxing_reader-*.wasm' -size +100k | grep -q . || \
  { echo "The build did not copy the door decoder (pnpm vendor:build)." >&2; exit 1; }; } && \
  if grep -rlE "build-placeholder" .next-build/standalone .next-build/static public dist; then \
  echo "A build placeholder was baked into the output (files above)." >&2; exit 1; \
  fi
# Standalone holds only what the server traces (ADR-036). A dynamic fs path
# once made Next 16.4 trace the whole repo into it (Dockerfile, docs, ops):
# anything beyond these entries, or beyond the PDF fonts under src/, means
# that happened again. The build log names the call ("whole project").
RUN for entry in $(ls -A .next-build/standalone); do \
  case "$entry" in \
  .next-build|node_modules|package.json|server.js|src|deployment-revision.json) ;; \
  *) echo "Next traced unexpected files into the server image: $entry" >&2; exit 1 ;; \
  esac; \
  done && \
  if find .next-build/standalone/src -type f ! -path '*/src/server/pdf/fonts/*' | grep .; then \
  echo "Next traced unexpected source files into the server image (above)." >&2; exit 1; \
  fi

# ---- plain Node runtime, without build tooling ----------------------------
# Start fresh, not from base: pnpm belongs only in the build stages.
FROM node:26.12.1-trixie-slim@sha256:36793bcbb160a6a16cede1e62b93f84e26b78a972a8a4c0b879c1c12f22761ec AS runtime-base
# The runtimes run node only. npm ships dependencies the app never uses,
# which otherwise become findings in both runtime image scans (9.9).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

# ---- web -----------------------------------------------------------------
FROM runtime-base AS web
ARG SOURCE_REVISION
# Links the GHCR package to the repo, so it inherits the repo's access.
LABEL org.opencontainers.image.source=https://github.com/Ashfak-Hossain/EchoAndAura
LABEL org.opencontainers.image.revision=${SOURCE_REVISION}
LABEL org.opencontainers.image.licenses=AGPL-3.0-only
WORKDIR /app
# A published image is the program conveyed: its licence goes with it, and
# the source label above says where the source is (ADR-087).
COPY LICENSE TRADEMARKS.md ./
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# distDir is .next-build (next.config.ts), so the standalone server looks
# for its static files and cache there.
COPY --from=build --chown=node:node /app/.next-build/standalone ./
COPY --from=build --chown=node:node /app/.next-build/static ./.next-build/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build /app/deployment-revision.json ./deployment-revision.json
# The image optimizer's cache (ADR-033): a volume in production, so resized
# covers survive a deploy. Created here so the node user owns it.
RUN mkdir -p .next-build/cache/images && chown -R node:node .next-build/cache
USER node
EXPOSE 3000
# Traefik routes nothing to a container until it reports healthy, and
# Docker's first check otherwise waits a full --interval: 30 s of downtime
# on every deploy. --start-interval checks every 2 s while it boots.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --start-interval=2s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health?live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server.js"]

# ---- worker (and ops scripts) --------------------------------------------
FROM runtime-base AS worker
ARG SOURCE_REVISION
LABEL org.opencontainers.image.source=https://github.com/Ashfak-Hossain/EchoAndAura
LABEL org.opencontainers.image.revision=${SOURCE_REVISION}
LABEL org.opencontainers.image.licenses=AGPL-3.0-only
WORKDIR /app
COPY LICENSE TRADEMARKS.md ./
ENV NODE_ENV=production
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build /app/deployment-revision.json ./deployment-revision.json
# The ticket PDF's fonts, read from <cwd>/src/server/pdf/fonts. The web image
# gets them through Next's file tracing; the worker bundle has no tracing, so
# without this line every ticket email failed (2026-09-28). The worker
# refuses to start if they are missing.
COPY --from=build --chown=node:node /app/src/server/pdf/fonts ./src/server/pdf/fonts
USER node
CMD ["node", "dist/worker.mjs"]
