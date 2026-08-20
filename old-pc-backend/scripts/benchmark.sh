#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${LOCAL_STUDIO_ENV_FILE:-$REPO_ROOT/.env.local}"
RECIPE_FILE="${RECIPE_FILE:-$SCRIPT_DIR/../config/gemma-4-e4b-it-q4km.recipe.json}"
REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/evaluation/reports}"
FIND_MAX_CTX="${FIND_MAX_CTX:-0}"
CTX_CANDIDATES="${CTX_CANDIDATES:-2048 4096 8192}"
PROMPT_FILE="${PROMPT_FILE:-$REPO_ROOT/evaluation/configs/backend-benchmark.json}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

HOST="${LOCAL_STUDIO_HOST:-127.0.0.1}"
PORT="${LOCAL_STUDIO_PORT:-8080}"
case "$HOST" in
  0.0.0.0|::) HOST="127.0.0.1" ;;
esac
CONTROLLER="http://${HOST}:${PORT}"
API_KEY="${LOCAL_STUDIO_API_KEY:-}"
DATA_DIR="${LOCAL_STUDIO_DATA_DIR:-/home/anon/.local/share/local-studio/data}"
LOG_PATH="${DATA_DIR}/instances/logs/llm.log"
LLAMA_BIN="${LOCAL_STUDIO_LLAMA_BIN:-}"

auth_args=()
if [[ -n "$API_KEY" ]]; then
  auth_args=(-H "Authorization: Bearer ${API_KEY}" -H "X-API-Key: ${API_KEY}")
fi

api() {
  local method="$1" path="$2"
  shift 2
  curl -fsS --max-time "${CURL_TIMEOUT:-120}" "${auth_args[@]}" -X "$method" "${CONTROLLER}${path}" "$@"
}

put_recipe() {
  local ctx="$1"
  python3 - "$RECIPE_FILE" "$ctx" <<'PY'
import json, sys
path, ctx = sys.argv[1], int(sys.argv[2])
with open(path, encoding="utf-8") as handle:
    recipe = json.load(handle)
recipe["max_model_len"] = ctx
recipe["extra_args"] = dict(recipe.get("extra_args") or {})
recipe["extra_args"]["n-gpu-layers"] = "all"
json.dump(recipe, sys.stdout)
PY
}

wait_ready() {
  python3 - "$CONTROLLER" "$API_KEY" <<'PY'
import json, sys, time, urllib.request
base, key = sys.argv[1], sys.argv[2]
deadline = time.time() + 420
headers = {"Authorization": f"Bearer {key}", "X-API-Key": key} if key else {}
while time.time() < deadline:
    req = urllib.request.Request(base + "/wait-ready?timeout=15", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            payload = json.loads(response.read().decode())
        if payload.get("ready"):
            raise SystemExit(0)
    except SystemExit:
        raise
    except Exception:
        time.sleep(2)
raise SystemExit("timeout waiting for backend")
PY
}

parse_offload() {
  python3 - "$LOG_PATH" <<'PY'
import re, sys
path = sys.argv[1]
text = open(path, encoding="utf-8", errors="replace").read()
matches = re.findall(r"offloaded\s+(\d+)/(\d+)\s+layers to GPU", text, re.I)
if not matches:
    print("0 0")
    raise SystemExit(0)
done, total = matches[-1]
print(f"{done} {total}")
PY
}

gpu_stats() {
  nvidia-smi --query-gpu=memory.used,utilization.gpu,utilization.memory --format=csv,noheader,nounits
}

run_one() {
  local ctx="$1"
  local recipe_id
  recipe_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("id"))' "$RECIPE_FILE")"
  local body
  body="$(put_recipe "$ctx")"
  printf '%s' "$body" | api POST "/recipes" -H 'Content-Type: application/json' --data-binary @- >/dev/null
  api POST /evict -H 'Content-Type: application/json' -d '{}' >/dev/null || true
  sleep 2
  local load_start load_end
  load_start="$(date +%s.%N)"
  api POST "/launch/${recipe_id}" -H 'Content-Type: application/json' -d '{}' >/dev/null
  wait_ready
  load_end="$(date +%s.%N)"
  local load_s
  load_s="$(python3 -c 'import sys; print(round(float(sys.argv[2])-float(sys.argv[1]),3))' _ "$load_start" "$load_end")"

  sleep 1
  local vram_idle vram_peak
  vram_idle="$(gpu_stats | awk -F, '{gsub(/ /,"",$1); print $1; exit}')"
  read -r off_done off_total <<<"$(parse_offload)"
  local cuda_ok=0
  grep -Eiq 'using device CUDA|NVIDIA GeForce GTX 1660 Ti' "$LOG_PATH" && cuda_ok=1
  if [[ "$off_done" != "$off_total" || "$off_total" == "0" || "$cuda_ok" != "1" ]]; then
    printf 'CTX %s did not reach full GPU residency (offload %s/%s cuda=%s)\n' "$ctx" "$off_done" "$off_total" "$cuda_ok" >&2
    return 1
  fi

  local payload ttft_ms total_ms
  payload="$(python3 - "$PROMPT_FILE" "$recipe_id" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1], encoding="utf-8"))
print(json.dumps({
    "model": sys.argv[2],
    "temperature": 0,
    "max_tokens": cfg["generation_tokens"],
    "stream": True,
    "messages": [{"role": "user", "content": cfg["prompt"]}],
}))
PY
)"

  local result
  result="$(python3 - "$CONTROLLER" "$API_KEY" "$payload" <<'PY'
import json, sys, time, urllib.request
base, key, payload = sys.argv[1], sys.argv[2], sys.argv[3]
headers = {"Content-Type": "application/json"}
if key:
    headers["Authorization"] = f"Bearer {key}"
    headers["X-API-Key"] = key
req = urllib.request.Request(base + "/v1/chat/completions", data=payload.encode(), headers=headers)
t0 = time.perf_counter()
ttft = None
text = []
usage = {}
timings = {}
with urllib.request.urlopen(req, timeout=180) as response:
    for raw in response:
        line = raw.decode("utf-8", "replace").strip()
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            break
        chunk = json.loads(data)
        if ttft is None:
            ttft = (time.perf_counter() - t0) * 1000
        delta = ((chunk.get("choices") or [{}])[0].get("delta") or {}).get("content") or ""
        if delta:
            text.append(delta)
        if chunk.get("usage"):
            usage = chunk["usage"]
        if chunk.get("timings"):
            timings = chunk["timings"]
elapsed = (time.perf_counter() - t0) * 1000
print(json.dumps({
    "ttft_ms": round(ttft or elapsed, 2),
    "total_ms": round(elapsed, 2),
    "text": "".join(text),
    "usage": usage,
    "timings": timings,
}))
PY
)"
  vram_peak="$(gpu_stats | awk -F, '{gsub(/ /,"",$1); print $1; exit}')"
  local util
  util="$(gpu_stats)"
  python3 - "$result" "$ctx" "$load_s" "$off_done" "$off_total" "$vram_idle" "$vram_peak" "$util" "$REPORT_DIR" "$recipe_id" "$LLAMA_BIN" <<'PY'
import json, os, subprocess, sys, time
from pathlib import Path
result = json.loads(sys.argv[1])
ctx = int(sys.argv[2])
load_s = float(sys.argv[3])
off_done, off_total = int(sys.argv[4]), int(sys.argv[5])
vram_idle, vram_peak = sys.argv[6], sys.argv[7]
util = sys.argv[8]
report_dir = Path(sys.argv[9])
recipe_id = sys.argv[10]
llama_bin = sys.argv[11]
usage = result.get("usage") or {}
timings = result.get("timings") or {}
prompt_tokens = usage.get("prompt_tokens") or timings.get("prompt_n") or 0
completion_tokens = usage.get("completion_tokens") or timings.get("predicted_n") or 0
total_tokens = usage.get("total_tokens") or (prompt_tokens + completion_tokens)
prompt_ms = timings.get("prompt_ms")
pred_ms = timings.get("predicted_ms")
pp = timings.get("prompt_per_second")
tg = timings.get("predicted_per_second")
if pp is None and prompt_ms and prompt_tokens:
    pp = prompt_tokens / (prompt_ms / 1000)
if tg is None and pred_ms and completion_tokens:
    tg = completion_tokens / (pred_ms / 1000)
parts = [p.strip() for p in util.split(",")]
gpu_util = parts[1] if len(parts) > 1 else None
version = ""
if llama_bin and os.path.exists(llama_bin):
    try:
        version = subprocess.check_output([llama_bin, "--version"], text=True, stderr=subprocess.STDOUT, timeout=5)
    except Exception:
        version = ""
host = subprocess.check_output(["hostname"], text=True).strip()
loadavg = os.getloadavg()[0]
mem_used_pct = None
try:
    meminfo = {}
    with open("/proc/meminfo", encoding="utf-8") as handle:
        for line in handle:
            key, value = line.split(":", 1)
            meminfo[key] = float(value.strip().split()[0])
    mem_used_pct = round((meminfo["MemTotal"] - meminfo["MemAvailable"]) * 100 / meminfo["MemTotal"], 1)
except Exception:
    mem_used_pct = None
report = {
    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "host": host,
    "recipe_id": recipe_id,
    "context_size": ctx,
    "gpu_layers": off_done,
    "total_layers": off_total,
    "cpu_offload_count": max(off_total - off_done, 0),
    "full_gpu_residency": off_done == off_total and off_total > 0,
    "model_load_seconds": load_s,
    "ttft_ms": result.get("ttft_ms"),
    "total_latency_ms": result.get("total_ms"),
    "prompt_tokens": prompt_tokens,
    "completion_tokens": completion_tokens,
    "total_tokens": total_tokens,
    "prompt_tokens_per_sec": round(pp, 2) if pp else None,
    "generation_tokens_per_sec": round(tg, 2) if tg else None,
    "vram_used_after_load_mib": float(vram_idle) if vram_idle else None,
    "peak_vram_mib": float(vram_peak) if vram_peak else None,
    "gpu_utilization_pct": float(gpu_util) if gpu_util else None,
    "cpu_loadavg_1m": loadavg,
    "ram_used_pct": mem_used_pct,
    "llama_cpp_version": version.strip(),
    "sample": (result.get("text") or "")[:240],
}
report_dir.mkdir(parents=True, exist_ok=True)
out = report_dir / f"old-pc-backend-{recipe_id}-c{ctx}.json"
out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2))
print(f"wrote {out}")
PY
}

mkdir -p "$REPORT_DIR"
api GET /health >/dev/null

if [[ "$FIND_MAX_CTX" == "1" ]]; then
  best=""
  for ctx in $CTX_CANDIDATES; do
    if run_one "$ctx"; then
      best="$ctx"
    else
      break
    fi
  done
  if [[ -z "$best" ]]; then
    echo "no context size achieved full GPU residency" >&2
    exit 1
  fi
  echo "maximum tested full-GPU context: $best"
else
  ctx="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("max_model_len", 2048))' "$RECIPE_FILE")"
  run_one "$ctx"
fi
