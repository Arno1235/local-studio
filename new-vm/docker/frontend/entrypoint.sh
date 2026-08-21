#!/bin/sh
set -eu

DATA_DIR="${LOCAL_STUDIO_DATA_DIR:-/var/lib/local-studio}"
AGENT_PORT="${LOCAL_STUDIO_AGENT_RUNTIME_PORT:-4784}"
export LOCAL_STUDIO_DATA_DIR="$DATA_DIR"
export PI_CODING_AGENT_DIR="${PI_CODING_AGENT_DIR:-$DATA_DIR/pi-agent}"
export LOCAL_STUDIO_AGENT_RUNTIME_URL="${LOCAL_STUDIO_AGENT_RUNTIME_URL:-http://127.0.0.1:${AGENT_PORT}}"
export LOCAL_STUDIO_FRONTEND_BASE="${LOCAL_STUDIO_FRONTEND_BASE:-http://127.0.0.1:${PORT:-4783}}"
mkdir -p "$DATA_DIR" "$PI_CODING_AGENT_DIR"

node -e '
const fs = require("fs");
const path = require("path");
const dir = process.env.LOCAL_STUDIO_DATA_DIR;
const file = path.join(dir, "api-settings.json");
const backendUrl = String(process.env.BACKEND_URL || "").replace(/\/+$/, "");
const apiKey = process.env.API_KEY || process.env.LOCAL_STUDIO_API_KEY || "";
let current = {};
try { current = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
const existing = String(current.backendUrl || "").replace(/\/+$/, "");
const local = !existing || /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:|\/|$)/i.test(existing);
const next = {
  backendUrl: local && backendUrl ? backendUrl : (existing || backendUrl),
  apiKey: current.apiKey || apiKey,
  voiceUrl: current.voiceUrl || "",
  voiceModel: current.voiceModel || "whisper-large-v3-turbo",
};
if (!next.backendUrl) process.exit(0);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
try { fs.chmodSync(file, 0o600); } catch {}
'

AGENT_PID=""
if [ -f /app/agent-runtime/standalone.mjs ]; then
  (
    export PORT="$AGENT_PORT"
    export HOSTNAME=127.0.0.1
    cd /app/agent-runtime
    exec node standalone.mjs
  ) &
  AGENT_PID=$!
  i=0
  while [ "$i" -lt 50 ]; do
    if curl -fsS "http://127.0.0.1:${AGENT_PORT}/health" 2>/dev/null | grep -q local-studio-agent-runtime; then
      break
    fi
    i=$((i + 1))
    sleep 0.2
  done
fi

if [ -f /app/frontend/server.js ]; then
  cd /app/frontend
  exec node server.js
fi
if [ -f /app/server.js ]; then
  exec node server.js
fi
echo "Next standalone server.js was not found" >&2
exit 1
