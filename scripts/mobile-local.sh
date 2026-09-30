#!/usr/bin/env bash
# Build and start the mobile web app locally, against the local server stack.
#
# The Dockerfile installs `@glyphh/sdk` from .sdk-vendor/ (CI vendors it the same
# way before a Fly deploy), so the sibling ../sdk checkout is copied in first —
# its dist/ as last built. Rebuild the SDK before this when sdk/src changed.
#
#   scripts/mobile-local.sh          build + start (http://localhost:3002)
#   MOBILE_PUBLIC_URL=https://<tunnel> scripts/mobile-local.sh   behind a tunnel
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d ../sdk/dist ]; then
  echo "../sdk/dist is missing — build the SDK first: (cd ../sdk && npm run build)" >&2
  exit 1
fi
rm -rf .sdk-vendor
mkdir -p .sdk-vendor
cp ../sdk/package.json .sdk-vendor/package.json
cp -R ../sdk/dist .sdk-vendor/dist

docker compose -f docker-compose.mobile.yml up -d --build
echo "mobile: ${MOBILE_PUBLIC_URL:-http://localhost:3002}  (server: the child on :4000)"
