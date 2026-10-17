#!/usr/bin/env bash
# Runs once inside the dev container, after it is created (ADR-080).
set -euo pipefail

# Docker creates the volumes owned by root.
sudo chown node:node node_modules docs-site/node_modules /home/node/.local/share/pnpm

pnpm install --frozen-lockfile

# The integration suite's database. The e2e suite makes its own each run
# (tests/e2e/prepare-db.ts), and each test file migrates what it uses.
pnpm exec dotenv -e .env -- tsx .devcontainer/create-test-db.ts

pnpm db:migrate

cat <<'EOF'

Dev container ready. Next:
  pnpm admin:create     the admin login
  pnpm db:seed          demo data
  pnpm dev              http://localhost:3000
Browsers for the e2e suite (once):
  sudo pnpm exec playwright install-deps chromium && pnpm exec playwright install chromium
EOF
