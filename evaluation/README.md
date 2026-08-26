# Evaluation

Custom lab suites for OpenAI-compatible local endpoints. This is **not** MMLU, HumanEval, HELM, or another standardized academic benchmark.

| Kind | How it is measured |
| --- | --- |
| Hardware / GPU-fit | Controller `/gpus`, recipe `n-gpu-layers`, VRAM, optional llama.cpp offload log |
| Latency / generation | Streaming TTFT, llama.cpp timings when present |
| Deterministic quality | Exact match, contains, regex, JSON/schema |
| Semantic quality | Cursor-manual JSON import or human import — never a paid API by default |
| Standardized benchmarks | **Not implemented** |

Default semantic path: generate a Cursor prompt, paste it into Cursor, save JSON, import. Cursor is not called through an API. No OpenAI/Anthropic/Gemini keys are required.

Gemma 4 E4B IT may emit a `reasoning_content` thinking channel before the visible answer. The runner scores only `content`, and uses `max(item.max_tokens, generation.max_tokens)` so thinking cannot consume the entire budget. Empty `content` with `completion_tokens` near the cap is logged as `truncated_before_answer`.

## Commands

Full walkthrough for comparing two models on speed, token use, and accuracy: [`mlflow-model-comparison.md`](mlflow-model-comparison.md).

```bash
bash new-vm/scripts/run-evaluation.sh run --suite smoke
bash new-vm/scripts/run-evaluation.sh run --suite standard
bash new-vm/scripts/run-evaluation.sh generate-cursor-review --run-id RUN_ID
bash new-vm/scripts/run-evaluation.sh import-cursor-review --run-id RUN_ID --file cursor-results.json
bash new-vm/scripts/run-evaluation.sh import-human-review --run-id RUN_ID --file human-results.json
bash new-vm/scripts/run-evaluation.sh compare --run-a RUN_A --run-b RUN_B
```

Equivalent:

```bash
./evaluation/run_evaluation.sh --suite standard
```

## Layout

- `datasets/v1/` — smoke / standard / extended JSON
- `configs/` — YAML run configuration
- `llm_lab_eval/` — runners, scorers, MLflow logging, reports
- `rubrics/` — Cursor evaluation rubric
- `schemas/` — import JSON schema
- `prompts/` — Cursor prompt to run smoke + llama-bench + EvalPlus on the NEW VM
- `output/` — generated reports (gitignored)
- `reports/gpu-bench-*.md` — filled unattended GPU-bench summaries (committed)

## Efficiency metrics

- `generation_tokens_per_sec` = completion tokens / generation seconds
- `prompt_tokens_per_sec` = prompt tokens / prefill seconds
- `successful_tasks_per_generated_token` = deterministic passes / completion tokens
- After Cursor/human import: `quality_per_output_token` = mean 1–5 score / completion tokens

There is no composite “token efficiency” index.

## Cloud judges

Disabled. Cursor subscription does not provide general-purpose API credits for MLflow judges. A separate provider API key/account is required and may incur API charges. Do not set cloud keys for the default workflow.
