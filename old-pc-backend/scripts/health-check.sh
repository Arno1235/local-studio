#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${LOCAL_STUDIO_ENV_FILE:-$REPO_ROOT/.env.local}"
MIN_FREE_GB="${HEALTHCHECK_MIN_FREE_GB:-10}"
ALLOW_UNLOADED="${HEALTHCHECK_ALLOW_UNLOADED:-0}"
FAILED=0

log() { printf '%s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; FAILED=1; }
ok() { printf 'OK: %s\n' "$*"; }

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  fail "missing env file $ENV_FILE"
fi

HOST="${LOCAL_STUDIO_HOST:-127.0.0.1}"
PORT="${LOCAL_STUDIO_PORT:-8080}"
case "$HOST" in
  0.0.0.0|::) HOST="127.0.0.1" ;;
esac
CONTROLLER="http://${HOST}:${PORT}"
MODELS_DIR="${LOCAL_STUDIO_MODELS_DIR:-/home/anon/.local/share/local-studio/models}"
LLAMA_BIN="${LOCAL_STUDIO_LLAMA_BIN:-}"
DATA_DIR="${LOCAL_STUDIO_DATA_DIR:-/home/anon/.local/share/local-studio/data}"
API_KEY="${LOCAL_STUDIO_API_KEY:-}"
LOG_PATH="${DATA_DIR}/instances/logs/llm.log"

auth_args=()
if [[ -n "$API_KEY" ]]; then
  auth_args=(-H "Authorization: Bearer ${API_KEY}" -H "X-API-Key: ${API_KEY}")
fi

curl_json() {
  local url="$1"
  shift
  curl -fsS --max-time 8 "${auth_args[@]}" "$@" "$url"
}

if [[ "$FAILED" -eq 0 ]]; then
  if health="$(curl -fsS --max-time 5 "${CONTROLLER}/health" 2>/dev/null)"; then
    ok "controller reachable at ${CONTROLLER}/health (${health})"
  else
    fail "controller not reachable at ${CONTROLLER}/health"
  fi
fi

if [[ "$FAILED" -eq 0 ]]; then
  if llama_info="$(curl_json "${CONTROLLER}/runtime/llamacpp" 2>/dev/null)"; then
    python3 - "$llama_info" <<'PY' || fail "llama.cpp runtime not actually present"
import json, os, sys
info = json.loads(sys.argv[1])
path = info.get("binary_path") or ""
base = os.path.basename(path)
if base in {"bash", "sh", "dash"}:
    raise SystemExit(f"controller reported non-llama binary {path}")
if not info.get("installed") and not path.endswith("llama-server"):
    raise SystemExit("llama.cpp not installed according to /runtime/llamacpp")
print(info.get("version") or "unknown")
print(path)
PY
    ok "llama.cpp runtime present"
  else
    fail "GET ${CONTROLLER}/runtime/llamacpp failed"
  fi
fi

if [[ -n "$LLAMA_BIN" && -x "$LLAMA_BIN" ]]; then
  if "$LLAMA_BIN" --version 2>&1 | grep -qiE 'llama|ggml|version'; then
    ok "llama-server binary executable: $LLAMA_BIN"
  else
    fail "llama-server --version failed: $LLAMA_BIN"
  fi
  if strings "$LLAMA_BIN" 2>/dev/null | grep -q 'ggml-cuda'; then
    ok "llama-server contains ggml-cuda"
  elif "$LLAMA_BIN" --help 2>&1 | grep -qiE 'gpu|cuda|ngl'; then
    ok "llama-server help advertises GPU flags"
  else
    fail "llama-server does not look CUDA-enabled"
  fi
else
  fail "LOCAL_STUDIO_LLAMA_BIN missing or not executable"
fi

if command -v nvidia-smi >/dev/null; then
  gpu_line="$(nvidia-smi --query-gpu=name,memory.total,memory.free,compute_cap,driver_version --format=csv,noheader)"
  if printf '%s\n' "$gpu_line" | grep -qi 'GeForce GTX 1660 Ti'; then
    ok "NVIDIA GPU detected: $gpu_line"
  else
    fail "expected GTX 1660 Ti, nvidia-smi reported: $gpu_line"
  fi
else
  fail "nvidia-smi not found"
fi

if gpus="$(curl_json "${CONTROLLER}/gpus" 2>/dev/null)"; then
  python3 - "$gpus" <<'PY' || fail "controller /gpus reported no NVIDIA device"
import json, sys
payload = json.loads(sys.argv[1])
gpus = payload.get("gpus") or []
if not gpus:
    raise SystemExit("empty gpu list")
print(f"{payload.get('count')} gpu(s)")
PY
  ok "controller /gpus responded"
else
  fail "GET ${CONTROLLER}/gpus failed"
fi

if [[ -d "$MODELS_DIR" ]]; then
  ok "model directory exists: $MODELS_DIR"
else
  fail "model directory missing: $MODELS_DIR"
fi

free_kb="$(df -P "$MODELS_DIR" | awk 'NR==2 {print $4}')"
free_gb="$((free_kb / 1024 / 1024))"
if [[ "$free_gb" -ge "$MIN_FREE_GB" ]]; then
  ok "free disk ${free_gb} GB on $(df -P "$MODELS_DIR" | awk 'NR==2 {print $1}')"
else
  fail "only ${free_gb} GB free under $MODELS_DIR (need ${MIN_FREE_GB} GB)"
fi

if models="$(curl_json "${CONTROLLER}/v1/models" 2>/dev/null)"; then
  ok "OpenAI-compatible /v1/models reachable"
else
  fail "GET ${CONTROLLER}/v1/models failed"
fi

active="$(python3 - "$models" <<'PY' 2>/dev/null || true
import json, sys
payload = json.loads(sys.argv[1])
active = [m.get("id") for m in payload.get("data") or [] if m.get("active")]
print(",".join(active))
PY
)"

if [[ -z "$active" ]]; then
  if [[ "$ALLOW_UNLOADED" == "1" ]]; then
    log "WARN: no active model (HEALTHCHECK_ALLOW_UNLOADED=1)"
  else
    fail "no active model on /v1/models; load the recipe before health-check"
  fi
else
  ok "active model: $active"
  prompt='{"model":"'"${active%%,*}"'","max_tokens":8,"temperature":0,"messages":[{"role":"user","content":"Reply with the single word pong."}]}'
  if curl_json "${CONTROLLER}/v1/chat/completions" -H 'Content-Type: application/json' -d "$prompt" >/tmp/local-studio-health-chat.json 2>/dev/null; then
    python3 - <<'PY' || fail "chat completion JSON missing choices"
import json
with open("/tmp/local-studio-health-chat.json", encoding="utf-8") as handle:
    payload = json.load(handle)
choices = payload.get("choices") or []
if not choices:
    raise SystemExit("no choices")
print((choices[0].get("message") or {}).get("content") or "")
PY
    ok "model endpoint answered a test chat completion"
  else
    fail "POST ${CONTROLLER}/v1/chat/completions failed"
  fi
fi

gpu_proc="$(nvidia-smi --query-compute-apps=pid,process_name,used_gpu_memory --format=csv,noheader 2>/dev/null || true)"
if printf '%s\n' "$gpu_proc" | grep -qiE 'llama|llama-server'; then
  ok "nvidia-smi shows llama.cpp on the GPU: $gpu_proc"
elif [[ "$ALLOW_UNLOADED" == "1" ]]; then
  log "WARN: no llama.cpp compute process on GPU"
else
  fail "nvidia-smi has no llama.cpp compute process (no silent CPU fallback allowed)"
fi

if [[ -f "$LOG_PATH" ]]; then
  if grep -Eiq 'offloaded [0-9]+/[0-9]+ layers to GPU' "$LOG_PATH"; then
    offload="$(grep -Ei 'offloaded [0-9]+/[0-9]+ layers to GPU' "$LOG_PATH" | tail -1)"
    python3 - "$offload" <<'PY' || fail "CPU layer offload detected in llama.cpp log"
import re, sys
line = sys.argv[1]
match = re.search(r"offloaded\s+(\d+)/(\d+)\s+layers to GPU", line, re.I)
if not match:
    raise SystemExit("unparseable offload line")
done, total = int(match.group(1)), int(match.group(2))
if done != total or total == 0:
    raise SystemExit(f"layer offload {done}/{total}")
print(f"{done}/{total}")
PY
    ok "llama.cpp log: $offload"
  else
    fail "llama.cpp log missing GPU layer-offload line: $LOG_PATH"
  fi
  if grep -Eiq 'using device CUDA|NVIDIA GeForce GTX 1660 Ti' "$LOG_PATH"; then
    ok "llama.cpp log names CUDA / GTX 1660 Ti"
  else
    fail "llama.cpp log does not mention CUDA or the GTX 1660 Ti"
  fi
elif [[ "$ALLOW_UNLOADED" != "1" ]]; then
  fail "missing llama.cpp instance log $LOG_PATH"
fi

if [[ "$FAILED" -ne 0 ]]; then
  log "health-check failed"
  exit 1
fi
log "health-check passed"
exit 0
