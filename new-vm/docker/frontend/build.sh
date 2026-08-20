#!/bin/sh
set -eu
cd /opt/local-studio
bun install --frozen-lockfile --cwd controller
bun install --frozen-lockfile --cwd shared
bun install --frozen-lockfile --cwd services/agent-runtime
npm ci --legacy-peer-deps --prefix frontend
npm --prefix services/agent-runtime run bundle
rm -rf frontend/.next .next
mkdir -p frontend/.next
ln -sfn frontend/.next .next
ln -sfn frontend/node_modules node_modules
(cd frontend && npx --no-install next build --webpack)
node scripts/project.mjs complete-standalone
node scripts/project.mjs assert-standalone
mkdir -p /out
if [ -f .next/standalone/frontend/server.js ] || [ -f .next/standalone/server.js ]; then
  cp -a .next/standalone/. /out/
elif [ -f frontend/.next/standalone/frontend/server.js ] || [ -f frontend/.next/standalone/server.js ]; then
  cp -a frontend/.next/standalone/. /out/
else
  echo "standalone server.js was not found" >&2
  find /opt/local-studio -name server.js | head -n 50 >&2
  exit 1
fi
if [ -d .next/static ]; then
  mkdir -p /out/frontend/.next /out/.next
  cp -a .next/static /out/frontend/.next/static
  cp -a .next/static /out/.next/static
elif [ -d frontend/.next/static ]; then
  mkdir -p /out/frontend/.next /out/.next
  cp -a frontend/.next/static /out/frontend/.next/static
  cp -a frontend/.next/static /out/.next/static
fi
mkdir -p /out/frontend/public /out/public
cp -a frontend/public/. /out/frontend/public/
cp -a frontend/public/. /out/public/
