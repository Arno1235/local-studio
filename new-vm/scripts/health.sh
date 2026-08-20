#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

URL="${OLD_PC_LOCAL_STUDIO_URL:-http://192.168.0.69:8080}"
KEY="${OLD_PC_LOCAL_STUDIO_API_KEY:-}"
MODEL="${OLD_PC_MODEL_NAME:-gemma-4-e4b-it-q4km}"
FRONTEND="http://127.0.0.1:${FRONTEND_PORT:-4783}"
MLFLOW="${MLFLOW_TRACKING_URI:-http://127.0.0.1:5000}"
FAILED=0

ok() { printf 'OK  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*" >&2; FAILED=1; }

if curl -fsS --max-time 8 "$FRONTEND/" >/dev/null; then
  ok "Local Studio frontend $FRONTEND"
else
  fail "Local Studio frontend $FRONTEND"
fi

if curl -fsS --max-time 8 "$MLFLOW/health" >/dev/null || curl -fsS --max-time 8 "$MLFLOW/" >/dev/null; then
  ok "MLflow $MLFLOW"
else
  fail "MLflow $MLFLOW"
fi

if curl -fsS --max-time 8 "$URL/health" >/dev/null; then
  ok "OLD PC controller $URL/health"
else
  fail "OLD PC controller $URL/health"
fi

if [[ -z "$KEY" ]]; then
  fail "OLD_PC_LOCAL_STUDIO_API_KEY is empty"
else
  if curl -fsS --max-time 12 -H "Authorization: Bearer $KEY" "$URL/v1/models" >/dev/null; then
    ok "OLD PC model API $URL/v1/models"
  else
    fail "OLD PC model API $URL/v1/models"
  fi
  if curl -fsS --max-time 20 -H "Authorization: Bearer $KEY" "$URL/v1/models" | grep -q "$MODEL"; then
    ok "model $MODEL is listed"
  else
    fail "model $MODEL is not listed"
  fi
  tmp="$(mktemp)"
  if curl -fsS --max-time 90 \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"${MODEL}\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with exactly: pong\"}],\"temperature\":0}" \
    "$URL/v1/chat/completions" >"$tmp"; then
    if grep -q pong "$tmp"; then
      ok "OLD PC completion $MODEL"
    else
      fail "OLD PC completion did not contain pong"
    fi
  else
    fail "OLD PC completion $URL/v1/chat/completions"
  fi
  rm -f "$tmp"
fi

exit "$FAILED"
