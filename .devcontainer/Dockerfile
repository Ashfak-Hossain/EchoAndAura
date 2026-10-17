# The dev container (ADR-080): the same Node and pnpm as the production
# image (the root Dockerfile's NODE_IMAGE, package.json's packageManager);
# tests/unit/devcontainer.test.ts keeps them equal. Pinned by digest as well
# as tag, like the MinIO fork (ADR-078); Dependabot moves both together.
FROM node:26.11.1-trixie-slim@sha256:193fe51b64e77981119c98c2002c9e32a70e2f006fb4d25068ce0558998917f0

# sudo for `node`: post-create hands the node_modules volumes to `node`, and
# `playwright install-deps` needs root. A dev box, never an image we ship.
# jq: the .claude/ hooks and statusline parse their input with it, and their
# tests run in `pnpm test`.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl jq sudo \
  && rm -rf /var/lib/apt/lists/* \
  && echo 'node ALL=(root) NOPASSWD:ALL' > /etc/sudoers.d/node \
  && chmod 0440 /etc/sudoers.d/node

# Node 25+ ships without corepack: install the pnpm package.json names.
RUN npm install -g pnpm@11.9.0 && npm cache clean --force

USER node
# The pnpm store volume mounts here; made now so ~/.local stays node's.
RUN mkdir -p /home/node/.local/share/pnpm
