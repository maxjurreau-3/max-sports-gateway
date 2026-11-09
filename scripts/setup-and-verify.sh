#!/usr/bin/env bash
set -euo pipefail

# The root wrangler.toml currently names the D1 binding DB and configures
# migrations_dir = "migrations". Apply the full ordered migration set locally.
echo "=== 1. Applying Local D1 Migrations ==="
npx wrangler d1 migrations apply DB --local

echo "=== 2. Running TypeScript Typecheck ==="
npx tsc --noEmit

echo "=== 3. Running Test Suite ==="
npm test

echo "=== Setup and Verification Complete Successfully ==="
