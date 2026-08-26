# GPU bench Cursor prompt (NEW VM)

Paste **this entire file** into Cursor on the **NEW VM** (`192.168.0.230`), after filling the Model card. Cursor must run the three automated benches, write one markdown report, and stop. Do not change Local Studio product code.

Comparable public numbers (optional context, do not fetch unless needed):

- EvalPlus HumanEval+ leaderboard: https://evalplus.github.io/leaderboard.html
- Gemma 4 E4B model card coding figure is LiveCodeBench v6, **not** HumanEval. HumanEval+ is still the right first coding score.

---

## Model card (edit this block only)

```yaml
# Identity
hf_repo: unsloth/gemma-4-E4B-it-GGUF
gguf_allow_patterns:
  - "*Q4_K_M*"
gguf_filename: gemma-4-E4B-it-Q4_K_M.gguf
served_model_name: gemma-4-e4b-it-q4km
recipe_id: gemma-4-e4b-it-q4km
recipe_display_name: Gemma 4 E4B IT Q4_K_M
quantization: Q4_K_M
backend: llamacpp
max_model_len: 8192
max_num_seqs: 1
max_new_tokens_evalplus: 2048
temperature: 0
seed: 42

# Lab (leave unless this host changed)
controller_url: http://192.168.0.69:8080
expected_gpu: NVIDIA GeForce GTX 1660 Ti
min_vram_used_mb: 2000
min_gpu_generation_tps: 12
```

If this model is already downloaded and loaded (the default lab state), skip download/launch. Still **evict before llama-bench**, then load again before smoke and EvalPlus.

---

## Your job

You are Cursor on the NEW VM checkout of `local-studio`. Inference runs only on the OLD PC GPU. You talk to the controller over LAN. You do not download GGUF onto this VM.

Run, in order:

1. Prepare the model on the OLD PC (download + recipe + GPU-free llama-bench + load).
2. Smoke the pipe (`evaluation` smoke suite).
3. `llama-bench` on the OLD PC (already done in step 1 if you followed the order below).
4. EvalPlus **HumanEval+** (dataset `humaneval`, greedy, report both Base and Base+Extra).
5. Write **one** markdown report at:

`evaluation/reports/gpu-bench-<served_model_name>.md`

Use the schema in `evaluation/reports/TEMPLATE-gpu-bench.md`. Overwrite that file if a previous run exists; git history keeps the old one.

Then stop. Do not start MBPP, Aider, SWE-bench, Cursor-manual review, or cloud judges.

### Hard rules

- Do not edit `controller/`, `frontend/`, `services/`, or other product source.
- You may add `evaluation/configs/<recipe_id>.yaml` if the smoke config is missing.
- You may write files under `evaluation/output/` (gitignored) and the single report markdown.
- Never print, commit, or paste API keys, `.env`, HF tokens, or GGUF bytes.
- One model on the GPU. Do not use Local Studio Chat or New Task during the run.
- `max_num_seqs` is 1: no parallel inference requests.
- Do not abort EvalPlus because it is slow. HumanEval is 164 tasks and can take several hours on the 1660 Ti. Resume is on by default. If the session dies, re-paste this prompt; codegen continues from the jsonl cache.
- If a stage is impossible (no SSH, no llama-bench binary, download gated), mark it `blocked` with the reason and continue the other stages.
- Smoke GPU-fit failure: record it, still attempt EvalPlus unless the model is not serving.

---

## Environment

From the repo root:

```bash
set -a
source .env
set +a
export CTL="${OLD_PC_LOCAL_STUDIO_URL:-http://192.168.0.69:8080}"
export KEY="${OLD_PC_LOCAL_STUDIO_API_KEY}"
export MODEL="<served_model_name from the card>"
auth() { curl -fsS -H "Authorization: Bearer $KEY" -H "X-API-Key: $KEY" "$@"; }
```

Abort if `KEY` is empty. Never echo `KEY`.

Optional SSH (for llama-bench only):

```bash
export SSH_HOST="${OLD_PC_SSH_HOST:-${OLD_PC_HOST:-192.168.0.69}}"
export SSH_USER="${OLD_PC_SSH_USER:-anon}"
export SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=8"
# OLD_PC_SSH_IDENTITY if set: add -i
ssh $SSH_OPTS "${SSH_USER}@${SSH_HOST}" true
```

If SSH fails, try `~/.ssh/config` hosts `old-pc` / `oldpc`. If all fail, llama-bench is `blocked`; do not invent another way to run a binary on the OLD PC.

---

## Stage 0 — health (do not treat frontend agent-runtime as fatal)

```bash
bash new-vm/scripts/health.sh || true
auth "$CTL/health"
auth "$CTL/gpus"
auth "$CTL/v1/models"
auth "$CTL/recipes"
```

Record GPU name, VRAM used/total, listed model ids, recipe statuses. Continue if only New Task agent-runtime failed.

---

## Stage 1 — download weights onto the OLD PC if needed

List local files: `GET $CTL/v1/studio/models`  
List downloads: `GET $CTL/studio/downloads`  
List recipes: `GET $CTL/recipes`

Need download when the GGUF named in the card is not already on the OLD PC.

```bash
auth -H "Content-Type: application/json" \
  -d "{\"model_id\":\"<hf_repo>\",\"allow_patterns\":[\"<gguf_allow_patterns>\"]}" \
  "$CTL/studio/downloads"
```

Poll `GET $CTL/studio/downloads/<id>` until `completed` or `failed`. If gated, send `hf_token` from the VM environment (`HF_TOKEN` / `HUGGINGFACE_TOKEN`) in the JSON body only; never write the token to the report.

Weights stay under the OLD PC models dir (typically `/home/anon/.local/share/local-studio/models/...`). Do not copy them here.

After completion, resolve the full GGUF path (`target_dir` + `gguf_filename`).

---

## Stage 2 — recipe

If `GET $CTL/recipes/<recipe_id>` exists, reuse it. Otherwise `POST $CTL/recipes` with:

```json
{
  "id": "<recipe_id>",
  "name": "<recipe_display_name>",
  "model_path": "<absolute GGUF path on OLD PC>",
  "backend": "llamacpp",
  "runtime": {
    "kind": "binary",
    "ref": "/home/anon/.local/share/local-studio/data/runtime/llamacpp/src/build/bin/llama-server"
  },
  "served_model_name": "<served_model_name>",
  "max_model_len": 8192,
  "max_num_seqs": 1,
  "port": 8081,
  "extra_args": {
    "n-gpu-layers": "all",
    "jinja": true,
    "verbose": true
  }
}
```

If `GET $CTL/runtime/llamacpp` or `/studio/diagnostics` returns a different `llama-server` path, use that as `runtime.ref`. Keep `n-gpu-layers: all`, `max_num_seqs: 1`, context 8192 unless the model cannot fit (then lower context, say so in the report).

Smoke config: reuse `evaluation/configs/gemma-4-e4b-it-q4km.yaml` when the served name matches. Otherwise copy it to `evaluation/configs/<recipe_id>.yaml` and set `model.name`, `model.quantization`, `generation.context_length`.

---

## Stage 3 — llama-bench (GPU must be free)

`llama-bench` loads the GGUF itself. The 6 GB card cannot hold llama-server and llama-bench at once.

1. `POST $CTL/evict`
2. Poll `GET $CTL/gpus` until VRAM used is near idle (display overhead only), up to ~60s.
3. Over SSH, locate the bench binary next to `llama-server`:

```text
<dir-of-llama-server>/llama-bench
```

Managed llama.cpp in this lab is often built with `--target llama-server` only. If `llama-bench` is missing, build just that target on the OLD PC:

```bash
cmake --build /home/anon/.local/share/local-studio/data/runtime/llamacpp/src/build \
  --target llama-bench -j"$(nproc)"
```

Do not change Local Studio source to do this. If the build fails, mark llama-bench `blocked`.

4. Run (3 repetitions is enough):

```bash
llama-bench \
  -m "<absolute GGUF path>" \
  -ngl 99 \
  -p 512,2048 \
  -n 128 \
  -r 3 \
  -o md
```

Also capture `-o json` if the binary supports it. Save the full table into the report. Record pp512, pp2048, tg128 tok/s.

5. After bench, load the recipe:

```bash
auth -X POST "$CTL/launch/<recipe_id>"
auth "$CTL/wait-ready?timeout=600"
```

Wait until `GET $CTL/v1/models` lists `<served_model_name>` and a short completion works:

```bash
auth -H "Content-Type: application/json" \
  -d "{\"model\":\"<served_model_name>\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with exactly: pong\"}],\"temperature\":0,\"max_tokens\":64}" \
  "$CTL/v1/chat/completions"
```

Gemma-style models may think in `reasoning_content` before `content`. Score visible `content`. If `content` is empty, raise `max_tokens` for this probe only.

---

## Stage 4 — smoke the pipe

```bash
bash new-vm/scripts/health.sh || true
bash new-vm/scripts/run-evaluation.sh run --config evaluation/configs/<recipe_id>.yaml --suite smoke
```

This prints JSON with `run_id` and `status`. Also read `evaluation/output/report-<run_id>.md`.

Copy into the report:

- MLflow `run_id`, `status`
- `auto.mean_ttft_s`, `auto.mean_latency_s`, `auto.mean_generation_tokens_per_sec`, `auto.mean_prompt_tokens_per_sec`
- `auto.deterministic_pass_rate`, `n_deterministic_pass` / `n_deterministic`
- `hardware.peak_vram_mb`, `hardware.full_gpu_residency`, offload layers, GPU-fit reasons
- Per-case `automatic_pass` for the six smoke ids

Smoke is a lab wiring suite, **not** HumanEval. Label it that way.

Do not run `standard`, `extended`, or Cursor-review import.

---

## Stage 5 — EvalPlus HumanEval+

Install in a throwaway venv (do not mix with `evaluation/.venv`):

```bash
python3 -m venv evaluation/.evalplus-venv
evaluation/.evalplus-venv/bin/pip install -U evalplus
export OPENAI_API_KEY="$KEY"
export OPENAI_BASE_URL="$CTL/v1"
```

Inspect flags: `evaluation/.evalplus-venv/bin/evalplus.codegen --help`

Generate (resume-safe, greedy, sequential):

```bash
mkdir -p evaluation/output/evalplus
evaluation/.evalplus-venv/bin/evalplus.codegen \
  --model "$MODEL" \
  --dataset humaneval \
  --backend openai \
  --base-url "$CTL/v1" \
  --greedy \
  --root evaluation/output/evalplus \
  --max-new-tokens 2048
```

`--max-new-tokens` must be the card value (default 2048). EvalPlus defaults to 768, which is too small for Gemma thinking. `--greedy` forces `temperature=0`, `n_samples=1`, `bs=1`.

If `evalplus.evaluate` can generate and score in one shot, that is fine; still pass the same backend/url/greedy/max-new-tokens and write samples under `evaluation/output/evalplus`.

Execute tests in Docker when Docker works:

```bash
docker run --rm --pull=always \
  -v "$PWD/evaluation/output/evalplus:/app" \
  ganler/evalplus:latest \
  evalplus.evaluate --dataset humaneval \
  --samples "/app/humaneval/<the jsonl from codegen>"
```

If Docker cannot pull that image, run `evalplus.evaluate --dataset humaneval --samples ...` locally and mark execution as `unsandboxed`.

Record:

- HumanEval Base `pass@1`
- HumanEval+ (Base + Extra) `pass@1`
- sample jsonl path
- n completed / 164
- wall clock
- any empty/truncated completions (thinking ate the budget)

Do not submit to the EvalPlus leaderboard unless the user later asks.

---

## Stage 6 — write the report

Write `evaluation/reports/gpu-bench-<served_model_name>.md` using every section in `evaluation/reports/TEMPLATE-gpu-bench.md`.

Fill every field. Use `n/a` or `blocked` with a reason; never leave a section out.

At the top, set:

- `status_overall`: `ok` only if smoke did not fail GPU-fit **and** HumanEval+ produced both pass@1 numbers. llama-bench `blocked` makes overall `partial`, not `ok`.
- `run_utc`: ISO-8601 UTC
- git SHA of this checkout

Commit **only** the report file (and a new `evaluation/configs/<recipe_id>.yaml` if you created one). Do not commit venvs, `evaluation/output/`, evalplus jsonl, or secrets.

---

## Order checklist

1. Health + inspect recipes/models/GPU
2. Download GGUF on OLD PC if missing
3. Create recipe if missing
4. Evict
5. llama-bench (SSH)
6. Launch recipe, wait-ready, pong probe
7. Smoke suite
8. EvalPlus HumanEval+
9. One markdown report
10. Commit report (and new yaml if any)
