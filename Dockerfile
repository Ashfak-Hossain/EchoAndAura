# syntax=docker/dockerfile:1.7
#
# ADR-036: two production images from one build.
#   web    — the Next.js standalone server (the site, /admin, /door)
#   worker — the BullMQ worker, plus the ops scripts (migrate, create-admin)
#
# Built by GitHub Actions (.github/workflows/deploy.yml), never on the VPS:
# a Next build needs more RAM and disk than the server should give it.
#
#   docker build --target web    --build-arg R2_PUBLIC_URL=https://… -t echoandaura-web .
#   docker build --target worker --build-arg R2_PUBLIC_URL=https://… -t echoandaura-worker .
#
# Both targets need the arg: they share the build stage, which runs
# `next build`, and the same value lets the second build reuse the first's.
#
# No secret is ever baked in. R2_PUBLIC_URL is public (every cover URL starts
# with it) and must be known at build time: Next bakes the image optimizer's
# allow-list into the build (ADR-033).

# Pinned exactly (CLAUDE.md). Keep in step with .nvmrc.
ARG NODE_IMAGE=node:26.10.0-trixie-slim

FROM ${NODE_IMAGE} AS base
# Node 25+ ships without corepack: install the pnpm package.json names.
RUN npm install -g pnpm@11.9.0 && npm cache clean --force
ENV PNPM_HOME=/pnpm NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ---- every dependency, for the build -------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store && \
  pnpm install --frozen-lockfile

# ---- runtime dependencies only, for the worker ---------------------------
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store && \
  pnpm install --frozen-lockfile --prod

# ---- build ---------------------------------------------------------------
FROM deps AS build
COPY . .
ARG R2_PUBLIC_URL
# APP_ENV=production makes a missing R2_PUBLIC_URL fail the build here,
# instead of a site whose covers never load (src/lib/image-config.ts).
ENV NEXT_OUTPUT=standalone APP_ENV=production R2_PUBLIC_URL=${R2_PUBLIC_URL}
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
RUN pnpm build && pnpm worker:build && pnpm ops:build && \
  if grep -rlE "build-placeholder" .next-build/standalone .next-build/static public dist; then \
  echo "A build placeholder was baked into the output (files above)." >&2; exit 1; \
  fi

# ---- web -----------------------------------------------------------------
FROM ${NODE_IMAGE} AS web
# Links the GHCR package to the repo, so it inherits the repo's access.
LABEL org.opencontainers.image.source=https://github.com/Ashfak-Hossain/EchoAndAura
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# distDir is .next-build (next.config.ts), so the standalone server looks
# for its static files and cache there.
COPY --from=build --chown=node:node /app/.next-build/standalone ./
COPY --from=build --chown=node:node /app/.next-build/static ./.next-build/static
COPY --from=build --chown=node:node /app/public ./public
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
FROM ${NODE_IMAGE} AS worker
LABEL org.opencontainers.image.source=https://github.com/Ashfak-Hossain/EchoAndAura
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/drizzle ./drizzle
USER node
CMD ["node", "dist/worker.mjs"]
