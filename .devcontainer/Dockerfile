# syntax=docker/dockerfile:1.10
#
# The dev container (ADR-080): the same Node and pnpm as the production
# image (the root Dockerfile's Node image, package.json's packageManager);
# tests/unit/devcontainer.test.ts keeps them equal. Pinned by digest as well
# as tag, like the MinIO fork (ADR-078); Dependabot moves both together.
FROM node:26.12.1-trixie-slim@sha256:36793bcbb160a6a16cede1e62b93f84e26b78a972a8a4c0b879c1c12f22761ec

# sudo for `node`: post-create hands the node_modules volumes to `node`, and
# `playwright install-deps` needs root. A dev box, never an image we ship.
# jq: the .claude/ hooks and statusline parse their input with it, and their
# tests run in `pnpm test`.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl jq sudo \
  && rm -rf /var/lib/apt/lists/* \
  && echo 'node ALL=(root) NOPASSWD:ALL' > /etc/sudoers.d/node \
  && chmod 0440 /etc/sudoers.d/node

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

USER node
# The pnpm store volume mounts here; made now so ~/.local stays node's.
RUN mkdir -p /home/node/.local/share/pnpm
