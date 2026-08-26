# GPU bench report

Fill every field. Use `n/a` or `blocked` plus a reason. Never leave a section out. Never put API keys, tokens, or `.env` values in this file.

```yaml
schema: gpu-bench-v1
run_utc: 2026-01-01T00:00:00Z
git_sha: ""
status_overall: ok | partial | failed
operator: cursor-new-vm
```

## 0. Identity

| Field | Value |
| --- | --- |
| hf_repo | |
| gguf_filename | |
| gguf_path_old_pc | |
| served_model_name | |
| recipe_id | |
| quantization | |
| backend | |
| engine_binary | |
| engine_version | |
| max_model_len | |
| max_num_seqs | |
| temperature | |
| seed | |
| max_new_tokens_evalplus | |
| controller_url | |
| evalplus_version | |

## 1. Hardware

| Field | Value |
| --- | --- |
| gpu_name | |
| vram_total_mb | |
| vram_used_mb_while_serving | |
| vram_used_mb_after_evict | |
| n_gpu_layers | |
| offloaded_layers | |
| total_layers | |
| cpu_offloaded_layers | |
| full_gpu_residency | true / false / unknown |
| notes | |

## 2. Setup

| Step | status (`ok` / `skipped` / `blocked` / `failed`) | notes |
| --- | --- | --- |
| health | | |
| download | | |
| recipe | | |
| evict | | |
| llama_bench_ssh | | |
| launch | | |
| wait_ready | | |
| pong_probe | | |

Download id (if any):
Recipe created this run (`yes` / `no`):

## 3. llama-bench (OLD PC via SSH)

Native llama.cpp `llama-bench` on the GPU host. Password SSH from the NEW VM. Never record the password.

```yaml
status: ok | failed | blocked
method: llama-bench-ssh
command: bash new-vm/scripts/run-evaluation.sh llama-bench --config evaluation/configs/...
ssh_user: ""
ssh_host: ""
binary: ""
mlflow_run_id: ""
```

### Results (tok/s)

| test | mean_tok_s | stdev | n_prompt | n_gen |
| --- | --- | --- | --- | --- |
| pp512 | | | | |
| pp2048 | | | | |
| tg128 | | | | |

Comparability: same flags as typical GGUF posts (`-ngl 99`, pp 512/2048, tg 128). Quant and GPU still have to match for a fair comparison.

Block/fail reason (if not `ok`):

## 4. Smoke pipe (lab suite, not HumanEval)

```yaml
status: ok | failed | blocked
suite: smoke
dataset: v1
config: evaluation/configs/...
mlflow_run_id: ""
mlflow_experiment: local-llm-performance
```

| metric | value |
| --- | --- |
| status | |
| n_samples | |
| n_deterministic_pass | |
| deterministic_pass_rate | |
| mean_ttft_s | |
| mean_latency_s | |
| mean_prompt_tokens_per_sec | |
| mean_generation_tokens_per_sec | |
| prompt_tokens | |
| completion_tokens | |
| errors | |
| timeouts | |
| peak_vram_mb | |
| wall_s | |
| gpu_fit | |
| gpu_fit_reasons | |

Per-case automatic pass:

| test_id | category | automatic_pass | error |
| --- | --- | --- | --- |
| smoke-math-001 | | | |
| smoke-fact-001 | | | |
| smoke-json-001 | | | |
| smoke-instr-001 | | | |
| smoke-code-001 | | | |
| smoke-concise-001 | | | |

This suite is exact/regex/JSON only. It is not a published coding benchmark.

## 5. EvalPlus HumanEval+

```yaml
status: ok | partial | failed | blocked
dataset: humaneval
leaderboard: https://evalplus.github.io/leaderboard.html
greedy: true
n_samples: 1
execution: docker | unsandboxed
samples_path: evaluation/output/evalplus/humaneval/...
```

| metric | value |
| --- | --- |
| tasks_completed | / 164 |
| humaneval_base_pass@1 | |
| humaneval_plus_pass@1 | |
| wall_s | |
| truncated_or_empty_completions | |
| notes | |

Stdout excerpt (the `Base` / `Base + Extra` dicts):

```
paste here
```

Comparability notes:

- Report both Base (original HumanEval) and Plus (HumanEval+ extra tests).
- Official Gemma 4 E4B card publishes LiveCodeBench v6, not HumanEval. Do not treat Plus pass@1 as that card number.
- Q4_K_M + 8k context + llama.cpp on a 1660 Ti is expected to score below full-precision card figures.

## 6. Summary

| bench | status | headline |
| --- | --- | --- |
| smoke | | pass_rate= ; gen_tok_s= |
| llama-bench | | pp512= ; pp2048= ; tg128= |
| humaneval+ | | base= ; plus= |

Overall: one paragraph. What ran, what was blocked, whether GPU-fit held, whether the numbers are publishable as a 1660 Ti Q4 result.
