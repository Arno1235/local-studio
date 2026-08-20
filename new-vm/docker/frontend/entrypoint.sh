#!/bin/sh
set -eu
if [ -f /app/frontend/server.js ]; then
  cd /app/frontend
  exec node server.js
fi
if [ -f /app/server.js ]; then
  exec node server.js
fi
echo "Next standalone server.js was not found" >&2
exit 1
