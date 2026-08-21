# Comparing models with MLflow (this lab)

This is the workflow for **this home lab**, not generic MLflow. Inference always runs on the **OLD PC** (`192.168.0.69`, GTX 1660 Ti). The **NEW VM** only records results into MLflow (`http://192.168.0.230:5000`).

MLflow does not load models and does not run the tests. You load one model on the GPU, run the evaluation CLI, then use MLflow to store and compare the runs.

## What you are comparing

| Axis | What it means here | Main MLflow metrics |
| --- | --- | --- |
| **Speed** | How fast the GPU serves this model | `auto.mean_ttft_s` (time to first token), `auto.mean_latency_s` (full reply), `auto.mean_generation_tokens_per_sec`, `auto.mean_prompt_tokens_per_sec`, `auto.wall_s` |
| **Token efficiency** | Work done per generated token (not a single composite score) | `auto.completion_tokens`, `auto.prompt_tokens`, `auto.successful_tasks_per_generated_token`; after a manual quality import, `cursor-manual.quality_per_output_token` |
| **Accuracy / intelligence** | Two layers: automatic checks, then a 1–5 human/Cursor review | `auto.deterministic_pass_rate`, per-case `case.<id>.automatic_pass`; after import, `cursor-manual.mean_score` and the per-criterion scores |

This lab suite is **not** MMLU, HumanEval, or another published benchmark. Treat it as a fixed custom test pack (`datasets/v1`) so model A and model B see the same prompts.

## Experiments in the UI

Open [http://192.168.0.230:5000](http://192.168.0.230:5000).

| Experiment | What lives there |
| --- | --- |
| `local-llm-performance` | Every evaluation run: speed, tokens, GPU, automatic pass rate. **Start here.** |
| `local-llm-quality` | Created so quality tags/imports have a home. The run itself is logged under performance; imported 1–5 scores attach to **that same run id**. |
| `local-llm-comparisons` | Output of `compare --run-a … --run-b …` (a JSON diff artifact, not a new GPU test). |

A successful run name looks like `gemma-4-e4b-it-q4km-standard`. Copy the **Run ID** from the run page (or from the CLI JSON). You need those IDs to import reviews and to compare.

## Fair comparison rules

Do these or the charts will lie:

1. **One model on the GPU at a time.** The 1660 Ti has 6 GB. Unload the previous model in Local Studio before loading the next.
2. **Same suite.** Compare `standard` to `standard`, not smoke to extended.
3. **Same generation settings** unless the change *is* the experiment (temperature, `max_tokens`, context length, seed). Defaults in `evaluation/configs/gemma-4-e4b-it-q4km.yaml`: temperature `0`, seed `42`, `max_tokens` `512`, context `8192`.
4. **Same dataset version** (`v1`). The compare helper records `evaluation.dataset_version` on each run.
5. **GPU-fit must be honest.** If the model spills to CPU, tok/s collapses. Those runs are tagged `gpu_fit=failed` and must not be published as a 1660 Ti result.
6. **Do not change the OLD PC mid-run** (do not unload, swap recipe, or start Chat/New Task that fights for the same llama.cpp server).

Gemma-style models may think in `reasoning_content` before the visible answer. The runner **scores only `content`**. A slow “thinker” can look worse on speed and token count even when the final answer is fine.

## End-to-end: two models on the three axes

### 1. Confirm the lab is up

On the NEW VM:

```bash
bash new-vm/scripts/health.sh
```

MLflow should be healthy. The OLD PC should already have a model loaded (today: `gemma-4-e4b-it-q4km`).

### 2. Run model A (baseline)

```bash
bash new-vm/scripts/run-evaluation.sh run --suite standard
```

Optional: `--config evaluation/configs/gemma-4-e4b-it-q4km.yaml`.

The command prints a `run_id`. Save it. That is **model A**.

Smoke (6 prompts) is only for wiring. **standard (20 prompts)** is the comparison suite. **extended (36)** is slower and still not an academic benchmark.

### 3. Score intelligence for model A (optional but needed for “accuracy”)

Automatic pass/fail only checks exact match, contains, regex, and JSON. That is **not** intelligence.

```bash
bash new-vm/scripts/run-evaluation.sh generate-cursor-review --run-id RUN_A
```

That writes:

- `evaluation/output/cursor-review-RUN_A/CURSOR_PROMPT.md`
- `evaluation/output/cursor-review-RUN_A/cases.json`

Paste the prompt into Cursor, get JSON back (no markdown fences), save it, then:

```bash
bash new-vm/scripts/run-evaluation.sh import-cursor-review --run-id RUN_A --file path/to/cursor-results.json
```

Scores are integers **1–5** (5 is best) for correctness, relevance, instruction following, completeness, reasoning, factuality, coding, structured output, plus an overall `score`. Those metrics appear on the **same** MLflow run.

You can import a human JSON the same way with `import-human-review`. Cloud LLM judges are **off** in this lab (no OpenAI/Anthropic/Gemini keys).

### 4. Load model B on the OLD PC

In Local Studio on the LAN (`http://192.168.0.230:4783`):

1. **Configure → models / recipes** (or the OLD PC UI, same controller).
2. Download the GGUF **on the OLD PC**. Do not download weights onto the NEW VM.
3. Create a recipe (quant, `n-gpu-layers: all`, context you can actually fit).
4. **Stop / unload** the current model.
5. Load model B. Wait until Status shows it **active**.

VRAM that barely fits will offload layers to CPU. If generation tok/s falls under the floor (12 tok/s in the default config), the run is failed for GPU-fit.

### 5. Add a config for model B

Copy the Gemma config:

```bash
cp evaluation/configs/gemma-4-e4b-it-q4km.yaml evaluation/configs/MODEL_B.yaml
```

Change at least:

- `model.name` — must match the **served id** on the controller (`/v1/models`)
- `model.quantization`
- `generation.context_length` if you had to lower it to stay on GPU

Keep `evaluation.dataset: v1` and use the same `--suite`.

### 6. Run model B

```bash
bash new-vm/scripts/run-evaluation.sh run --config evaluation/configs/MODEL_B.yaml --suite standard
```

Save `run_id` as **RUN_B**. Repeat the Cursor review import if you want intelligence scores on B as well.

### 7. Record a pairwise diff (optional)

```bash
bash new-vm/scripts/run-evaluation.sh compare --run-a RUN_A --run-b RUN_B
```

This does **not** call the GPU. It writes a comparison run under `local-llm-comparisons` with `b_minus_a` for every metric both runs share.

### 8. Read it in MLflow

1. Open `local-llm-performance`.
2. Filter or scan run names (`model-suite`).
3. Tick **two or more runs** → **Compare**.
4. Look at the metric table and charts.

What to look at:

**Speed (lower latency / higher tok/s is better)**

- `auto.mean_ttft_s` — snappiness
- `auto.mean_generation_tokens_per_sec` — decode speed on the 1660 Ti
- `auto.mean_prompt_tokens_per_sec` — prefill speed
- `auto.mean_latency_s` / `auto.wall_s` — wall clock for the whole suite
- `hardware.peak_vram_mb` — who fits

**Token efficiency (context-dependent)**

- Lower `auto.completion_tokens` for the **same** quality is more efficient.
- `auto.successful_tasks_per_generated_token` = automatic passes / completion tokens. A terse model that still passes looks better; a rambling thinker looks worse.
- After review: `cursor-manual.quality_per_output_token` = mean 1–5 / completion tokens.

There is **no** single “efficiency index”. Do not average speed and quality into one number unless you define the weights yourself.

**Accuracy / intelligence**

- `auto.deterministic_pass_rate` and `auto.n_deterministic_pass` — lab checks only.
- Per prompt: `case.<test_id>.automatic_pass` (1 or 0).
- After import: `cursor-manual.mean_score` (1–5) and `cursor-manual.<test_id>.score`.
- Open the run → **Artifacts** for the JSON/Markdown report with full prompts and outputs.

A model can win automatic pass rate and lose the 1–5 review (or the reverse). Report both.

## How to add a third model

Repeat steps 4–6. In the MLflow compare view, select all three runs. The CLI `compare` command is pairwise only; for three models use the UI (or run compare twice).

## How to read a “win”

Use this as a default reading, then override if your use case is different:

| If you care about… | Prefer the model with… |
| --- | --- |
| Interactive chat | Lower `auto.mean_ttft_s`, higher `auto.mean_generation_tokens_per_sec`, GPU-fit ok |
| Cheap / small answers | Fewer `auto.completion_tokens` at similar `cursor-manual.mean_score` |
| Getting the answers right | Higher `cursor-manual.mean_score` and `auto.deterministic_pass_rate` on **standard** |
| Fitting the 1660 Ti | `hardware.full_gpu_residency` = 1, peak VRAM under ~6 GB, tok/s not in CPU territory |

A Q4 tiny model will often win speed and lose intelligence. A larger quant that offloads to CPU will lose speed and may still lose quality if it times out. That is still a valid lab result — label it as such.

## Checklist before you trust a comparison

- [ ] Both runs used `--suite standard` (or both extended)
- [ ] `model.name` and quantization in params match what was actually loaded
- [ ] `gpu_fit` is not `failed` (unless you are studying offload)
- [ ] Temperature/seed/max_tokens match
- [ ] Intelligence scores imported for both if you are claiming accuracy
- [ ] You looked at a few failing `case.*` artifacts, not only the means

## Commands (copy-paste)

```bash
# health
bash new-vm/scripts/health.sh

# model currently loaded on the OLD PC
bash new-vm/scripts/run-evaluation.sh run --suite standard

# intelligence (manual)
bash new-vm/scripts/run-evaluation.sh generate-cursor-review --run-id RUN_ID
bash new-vm/scripts/run-evaluation.sh import-cursor-review --run-id RUN_ID --file cursor-results.json

# after switching the loaded model / config
bash new-vm/scripts/run-evaluation.sh run --config evaluation/configs/MODEL_B.yaml --suite standard

# pairwise metric diff into local-llm-comparisons
bash new-vm/scripts/run-evaluation.sh compare --run-a RUN_A --run-b RUN_B
```

MLflow UI: [http://192.168.0.230:5000](http://192.168.0.230:5000) → experiment `local-llm-performance` → select runs → Compare.
