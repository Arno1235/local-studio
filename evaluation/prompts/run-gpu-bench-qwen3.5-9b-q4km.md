# GPU bench Cursor prompt (NEW VM)

Paste **this entire file** into Cursor on the **NEW VM** (`192.168.0.230`) after the Model card is filled. Cursor must run all benches unattended, write one markdown report, and stop. Do not ask the operator questions. Do not change Local Studio product code.

Native **llama-bench** on the OLD PC GPU is the speed number (comparable to other GGUF posts). The OLD PC uses SSH **username + password**, not a key. Read those from `.env` or from this Model card. Never print or commit the password.

Comparable public numbers (optional context, do not fetch unless needed):

- EvalPlus HumanEval+ leaderboard: https://evalplus.github.io/leaderboard.html
- Gemma 4 E4B model card coding figure is LiveCodeBench v6, **not** HumanEval. HumanEval+ is still the right first coding score.

---

## Model card (edit this block only)

```yaml
# Identity
hf_repo: unsloth/Qwen3.5-9B-GGUF
gguf_allow_patterns:
  - "*Q4_K_M*"
gguf_filename: Qwen3.5-9B-Q4_K_M.gguf
served_model_name: qwen3.5-9b-q4km
recipe_id: qwen3.5-9b-q4km
recipe_display_name: Qwen3.5 9B Q4_K_M
quantization: Q4_K_M
backend: llamacpp
max_model_len: 8192
max_num_seqs: 1
max_new_tokens_evalplus: 2048
temperature: 0
seed: 42

# Lab
controller_url: http://192.168.0.69:8080
expected_gpu: NVIDIA GeForce GTX 1660 Ti
min_vram_used_mb: 2000
min_gpu_generation_tps: 12

# SSH to OLD PC for llama-bench (password auth). Prefer .env so you can paste this
# file unchanged. If .env is missing the password, fill ssh_password here for this run.
ssh_host: 192.168.0.69
ssh_user: anon
ssh_port: 22
ssh_password: ""
```

If the model is already downloaded, skip download. llama-bench **evicts** the server, benches, then loads the recipe again. Do not use Chat or New Task during the run.

---

## Your job

You are Cursor on the NEW VM checkout of `local-studio`. Inference runs only on the OLD PC GPU. Weights stay on the OLD PC.

Run, in order, with no confirmation steps:

1. Prepare the model (download + recipe if needed).
2. Native **llama-bench** on the OLD PC over SSH (pp512, pp2048, tg128).
3. Smoke the pipe.
4. EvalPlus **HumanEval+** (dataset `humaneval`, greedy, Base and Base+Extra).
5. Write **one** markdown report:

`evaluation/reports/gpu-bench-<served_model_name>.md`

Use `evaluation/reports/TEMPLATE-gpu-bench.md`. Overwrite if a previous run exists. Then commit and push that report so it is on the remote.

Then stop. Do not start MBPP, Aider, SWE-bench, Cursor-manual review, served-bench, or cloud judges.

### Hard rules

- Do not edit `controller/`, `frontend/`, `services/`, or other product source.
- You may add `evaluation/configs/<recipe_id>.yaml` if the smoke config is missing.
- You may write files under `evaluation/output/` (gitignored) and the single report markdown.
- Never print, commit, or write into git: API keys, `.env`, SSH passwords, HF tokens, GGUF bytes.
- Never put `ssh_password` into the report, MLflow, or any committed file.
- One model on the GPU. `max_num_seqs` is 1.
- Do not abort EvalPlus because it is slow. 164 tasks can take several hours. Codegen resumes from jsonl if you re-paste this prompt.
- If SSH/llama-bench fails, record `failed` with the redacted error, reload the model if possible, and continue smoke + EvalPlus.
- Do not prompt the operator. If SSH password is missing from both `.env` and this card, mark llama-bench failed with that reason and continue.

---

## Environment

```bash
set -a
source .env
set +a
export CTL="${OLD_PC_LOCAL_STUDIO_URL:-http://192.168.0.69:8080}"
export KEY="${OLD_PC_LOCAL_STUDIO_API_KEY}"
export MODEL="<served_model_name from the card>"
auth() { curl -fsS -H "Authorization: Bearer $KEY" -H "X-API-Key: $KEY" "$@"; }
```

Abort the whole run only if `KEY` is empty. Never echo `KEY` or the SSH password.

SSH password resolution (first match wins):

1. `OLD_PC_SSH_PASSWORD` already in the environment from `.env`
2. Else `ssh_password` from this Model card: write it to a `0600` tempfile, pass `--ssh-password-file`, delete the tempfile in a `trap` after llama-bench
3. Else llama-bench fails; do not wait for input

If the card has `ssh_user` / `ssh_host` / `ssh_port`, export `OLD_PC_SSH_USER`, `OLD_PC_SSH_HOST`, `OLD_PC_SSH_PORT` for the llama-bench process.

Do not use `sshpass`, interactive `ssh`, or `ssh-copy-id`. The lab CLI uses Paramiko.

---

## Stage 0 — health (frontend agent-runtime failure is not fatal)

```bash
bash new-vm/scripts/health.sh || true
auth "$CTL/health"
auth "$CTL/gpus"
auth "$CTL/v1/models"
auth "$CTL/recipes"
```

Record GPU name, VRAM, model ids, recipe statuses.

---

## Stage 1 — download weights onto the OLD PC if needed

`GET $CTL/v1/studio/models`, `GET $CTL/studio/downloads`, `GET $CTL/recipes`.

Download only if the GGUF is missing:

```bash
auth -H "Content-Type: application/json" \
  -d "{\"model_id\":\"<hf_repo>\",\"allow_patterns\":[\"<gguf_allow_patterns>\"]}" \
  "$CTL/studio/downloads"
```

Poll until `completed` or `failed`. If gated, send `hf_token` from `HF_TOKEN` / `HUGGINGFACE_TOKEN` in JSON only.

Resolve the absolute GGUF path (`target_dir` + `gguf_filename`). Do not copy weights to this VM.

---

## Stage 2 — recipe

Reuse `GET $CTL/recipes/<recipe_id>` when it exists. Otherwise `POST $CTL/recipes`:

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

If `/runtime/llamacpp` or `/studio/diagnostics` has another `llama-server` path, use that as `runtime.ref`. Keep `n-gpu-layers: all`, `max_num_seqs: 1`, context 8192 unless it cannot fit.

Smoke config: reuse `evaluation/configs/gemma-4-e4b-it-q4km.yaml` when the served name matches. Otherwise copy it to `evaluation/configs/<recipe_id>.yaml` and set `model.name` / `model.quantization` / `generation.context_length`.

---

## Stage 3 — llama-bench on the OLD PC (SSH password)

This is the speed stage. It must run the **llama-bench binary** on the GPU host. The CLI evicts llama-server (6 GB cannot hold both), runs `-ngl 99 -p 512,2048 -n 128 -r 3`, then launches the recipe again.

```bash
bash new-vm/scripts/run-evaluation.sh llama-bench \
  --config evaluation/configs/<recipe_id>.yaml
```

If the password lives only in this Model card:

```bash
PASSFILE="$(mktemp)"
chmod 600 "$PASSFILE"
trap 'rm -f "$PASSFILE"' EXIT
# write ssh_password bytes only; do not echo
bash new-vm/scripts/run-evaluation.sh llama-bench \
  --config evaluation/configs/<recipe_id>.yaml \
  --ssh-password-file "$PASSFILE"
```

Copy `evaluation/output/llama-bench-<served_model_name>.md` into the report. Record pp512, pp2048, tg128 tok/s.

If `llama-bench` is not next to `llama-server`, the remote script builds `--target llama-bench` only. That is allowed.

After this stage the model must be serving again (`/v1/models` lists `<served_model_name>`). If reload failed, `POST /launch/<recipe_id>` and `GET /wait-ready?timeout=600` yourself, then pong-probe.

Pong probe:

```bash
auth -H "Content-Type: application/json" \
  -d "{\"model\":\"<served_model_name>\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with exactly: pong\"}],\"temperature\":0,\"max_tokens\":64}" \
  "$CTL/v1/chat/completions"
```

Gemma may think in `reasoning_content` first. Raise `max_tokens` on this probe only if `content` is empty.

---

## Stage 4 — smoke the pipe

```bash
bash new-vm/scripts/health.sh || true
bash new-vm/scripts/run-evaluation.sh run --config evaluation/configs/<recipe_id>.yaml --suite smoke
```

Copy `run_id`, GPU-fit, tok/s, pass rate, and the six case results from `evaluation/output/report-<run_id>.md`.

Smoke is lab wiring, **not** HumanEval. Do not run `standard`, `extended`, or Cursor-review import.

---

## Stage 5 — EvalPlus HumanEval+

```bash
python3 -m venv evaluation/.evalplus-venv
evaluation/.evalplus-venv/bin/pip install -U evalplus
export OPENAI_API_KEY="$KEY"
export OPENAI_BASE_URL="$CTL/v1"
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

`--max-new-tokens` is the card value (default 2048). `--greedy` forces temperature 0, one sample, batch size 1.

Execute in Docker when possible:

```bash
docker run --rm --pull=always \
  -v "$PWD/evaluation/output/evalplus:/app" \
  ganler/evalplus:latest \
  evalplus.evaluate --dataset humaneval \
  --samples "/app/humaneval/<the jsonl from codegen>"
```

Otherwise `evalplus.evaluate` locally and mark `unsandboxed`.

Record Base `pass@1`, Plus `pass@1`, tasks  / 164, wall clock, truncated completions.

---

## Stage 6 — write the report and push it

Write `evaluation/reports/gpu-bench-<served_model_name>.md` from `evaluation/reports/TEMPLATE-gpu-bench.md`.

`status_overall` is `ok` only if llama-bench produced pp512/pp2048/tg128, smoke did not fail GPU-fit, and HumanEval+ produced both pass@1 numbers.

The report must land on the remote, not only on this disk:

```bash
git add evaluation/reports/gpu-bench-<served_model_name>.md
# also add evaluation/configs/<recipe_id>.yaml if you created it
git commit -m "docs(eval): gpu-bench report for <served_model_name>"
git push -u origin HEAD
```

Stay on the current branch (do not switch). Push that branch. If `git push` fails, retry with backoff; the job is not done until `origin` has the report file.

Commit **only** the report (and a new `evaluation/configs/<recipe_id>.yaml` if created). Do not commit venvs, `evaluation/output/`, evalplus jsonl, `.env`, or secrets.

---

## Order checklist

1. Health
2. Download GGUF if missing
3. Create recipe if missing
4. llama-bench over SSH (evict → bench → reload)
5. Pong probe
6. Smoke
7. EvalPlus HumanEval+
8. One markdown report
9. Commit **and push** the report to origin (and new yaml if any)
