# GPU bench report

Fill every field. Use `n/a` or `blocked` plus a reason. Never leave a section out. Never put API keys, tokens, or `.env` values in this file.

```yaml
schema: gpu-bench-v1
run_utc: 2026-08-30T20:59:01Z
git_sha: "b1963abb193fa3479cc40732107869dd58c2f1a6"
status_overall: ok
operator: cursor-new-vm
```

## 0. Identity

| Field | Value |
| --- | --- |
| hf_repo | unsloth/gemma-4-E4B-it-GGUF |
| gguf_filename | gemma-4-E4B-it-Q4_K_M.gguf |
| gguf_path_old_pc | /home/anon/.local/share/local-studio/models/unsloth/gemma-4-E4B-it-GGUF/gemma-4-E4B-it-Q4_K_M.gguf |
| served_model_name | gemma-4-e4b-it-q4km |
| recipe_id | gemma-4-e4b-it-q4km |
| quantization | Q4_K_M |
| backend | llamacpp |
| engine_binary | /home/anon/.local/share/local-studio/data/runtime/llamacpp/src/build/bin/llama-server |
| engine_version | 0.1.2-dev (llama-bench build 07822bd) |
| max_model_len | 8192 |
| max_num_seqs | 1 |
| temperature | 0 |
| seed | 42 |
| max_new_tokens_evalplus | 2048 (requested; evalplus 0.3.1 CLI has no `--max-new-tokens` flag) |
| controller_url | http://192.168.0.69:8080 |
| evalplus_version | 0.3.1 |

## 1. Hardware

| Field | Value |
| --- | --- |
| gpu_name | NVIDIA GeForce GTX 1660 Ti |
| vram_total_mb | 6144 |
| vram_used_mb_while_serving | 3258 (after launch); smoke peak 3272 |
| vram_used_mb_after_evict | 1 |
| n_gpu_layers | all (recipe); llama-bench `-ngl 99` |
| offloaded_layers | unknown |
| total_layers | unknown |
| cpu_offloaded_layers | unknown |
| full_gpu_residency | true |
| notes | Residency inferred from telemetry (VRAM ~3.2 GiB used, recipe `n-gpu-layers: all`, CUDA). llama.cpp offload log line was not in controller logs. llama-bench stderr: 1660 Ti has no tensor cores (compute 7.5). GGUF reports 7.518e9 params / 4961343656 bytes. OLD PC system RAM is 5.8 GiB. |

## 2. Setup

| Step | status (`ok` / `skipped` / `blocked` / `failed`) | notes |
| --- | --- | --- |
| health | ok | First `/v1/chat/completions` was 503 because the recipe was `stopped`. After launch, health.sh and pong succeeded. Frontend/MLflow/controller were up. |
| download | skipped | GGUF already on the OLD PC (`studio/models` listed `gemma-4-E4B-it-GGUF`, 4977171584 bytes). `/studio/downloads` was empty. |
| recipe | skipped | Reused existing `gemma-4-e4b-it-q4km` (llamacpp, port 8081, `n-gpu-layers: all`, jinja, verbose, max_num_seqs 1, context 8192). |
| evict | ok | Idle VRAM 1 MiB in 0.96 s. |
| llama_bench_ssh | ok | Native `llama-bench` over password SSH. First CLI run finished SSH then crashed on `POST /launch` (`RemoteDisconnected`) before writing artifacts. Retry with `--no-reload` wrote artifacts. |
| launch | ok | After bench, `POST /launch/gemma-4-e4b-it-q4km` returned `Launch started` (~106 s). Later relaunches often dropped the HTTP connection while the process still started. |
| wait_ready | ok | `/wait-ready?timeout=600` returned `ready: true`. `/v1/models` listed `gemma-4-e4b-it-q4km` with `active: true`. |
| pong_probe | ok | `content` was `pong` at `max_tokens` 64. Repeat after the EvalPlus controller drop also returned `pong`. |

Download id (if any): n/a
Recipe created this run (`yes` / `no`): no

## 3. llama-bench (OLD PC via SSH)

Native llama.cpp `llama-bench` on the GPU host. Password SSH from the NEW VM. Never record the password.

```yaml
status: ok
method: llama-bench-ssh
command: bash new-vm/scripts/run-evaluation.sh llama-bench --config evaluation/configs/gemma-4-e4b-it-q4km.yaml
ssh_user: "anon"
ssh_host: "192.168.0.69"
binary: "/home/anon/.local/share/local-studio/data/runtime/llamacpp/src/build/bin/llama-bench"
mlflow_run_id: "92a0422c4def46a18a643e97ce3a15bd"
```

### Results (tok/s)

| test | mean_tok_s | stdev | n_prompt | n_gen |
| --- | --- | --- | --- | --- |
| pp512 | 183.752253 | 5.194478 | 512.0 | 0.0 |
| pp2048 | 232.647474 | 14.286503 | 2048.0 | 0.0 |
| tg128 | 60.59881 | 2.462584 | 0.0 | 128.0 |

Comparability: same flags as typical GGUF posts (`-ngl 99`, pp 512/2048, tg 128). Quant and GPU still have to match for a fair comparison.

Block/fail reason (if not `ok`): n/a

Copied from `evaluation/output/llama-bench-gemma-4-e4b-it-q4km.md`:

- Status: **ok**
- Host: `192.168.0.69` user `anon`
- Binary: `/home/anon/.local/share/local-studio/data/runtime/llamacpp/src/build/bin/llama-bench`
- GGUF: `/home/anon/.local/share/local-studio/models/unsloth/gemma-4-E4B-it-GGUF/gemma-4-E4B-it-Q4_K_M.gguf`

## 4. Smoke pipe (lab suite, not HumanEval)

```yaml
status: ok
suite: smoke
dataset: v1
config: evaluation/configs/gemma-4-e4b-it-q4km.yaml
mlflow_run_id: "103b529a24f74429bbe51018acd70511"
mlflow_experiment: local-llm-performance
```

| metric | value |
| --- | --- |
| status | ok |
| n_samples | 6 |
| n_deterministic_pass | 6 |
| deterministic_pass_rate | 1.0 |
| mean_ttft_s | 2.9309912723333205 |
| mean_latency_s | 3.404086652833371 |
| mean_prompt_tokens_per_sec | 88.23198764633246 |
| mean_generation_tokens_per_sec | 38.08952607090118 |
| prompt_tokens | 178.0 |
| completion_tokens | 77.0 |
| errors | 0 |
| timeouts | 0 |
| peak_vram_mb | 3272.0 |
| wall_s | 25.049466861999917 |
| gpu_fit | pass (failed=false, full_gpu_residency=true, inferred) |
| gpu_fit_reasons | llama.cpp layer-offload log was not available; residency inferred from telemetry |

Per-case automatic pass:

| test_id | category | automatic_pass | error |
| --- | --- | --- | --- |
| smoke-math-001 | mathematics | true | null |
| smoke-fact-001 | factual-qa | true | null |
| smoke-json-001 | extraction | true | null |
| smoke-instr-001 | instruction-following | true | null |
| smoke-code-001 | coding | true | null |
| smoke-concise-001 | concise | true | null |

This suite is exact/regex/JSON only. It is not a published coding benchmark.

## 5. EvalPlus HumanEval+

```yaml
status: ok
dataset: humaneval
leaderboard: https://evalplus.github.io/leaderboard.html
greedy: true
n_samples: 1
execution: docker
samples_path: evaluation/output/evalplus/humaneval/gemma-4-e4b-it-q4km_openai_temp_0.0.jsonl
```

| metric | value |
| --- | --- |
| tasks_completed | 164 / 164 |
| humaneval_base_pass@1 | 0.140 |
| humaneval_plus_pass@1 | 0.140 |
| wall_s | 5293 (codegen 21:33:01Z–23:01:14Z, includes controller outage) |
| truncated_or_empty_completions | 119 / 164 empty in both sanitized and raw jsonl |
| notes | evalplus 0.3.1 Fire CLI has no `--max-new-tokens`; after 164/164 it exited 2 with `Could not consume arg: --max-new-tokens`. Controller/llama-server died at HumanEval/140 (~22:17Z); recipe relaunched; codegen resumed from jsonl at 22:53:28Z and finished 24 remaining tasks in 7m43s. Docker image `ganler/evalplus:latest` digest sha256:26b118098bef281fe8dfe999bf05f1d5b45374b4e6c00161ec0f30592aef4740. |

Stdout excerpt (the `Base` / `Base + Extra` dicts):

```
humaneval (base tests)
pass@1:	0.140
humaneval+ (base + extra tests)
pass@1:	0.140
```

Comparability notes:

- Report both Base (original HumanEval) and Plus (HumanEval+ extra tests).
- Official Gemma 4 E4B card publishes LiveCodeBench v6, not HumanEval. Do not treat Plus pass@1 as that card number.
- Q4_K_M + 8k context + llama.cpp on a 1660 Ti is expected to score below full-precision card figures.

## 6. Summary

| bench | status | headline |
| --- | --- | --- |
| smoke | ok | pass_rate=1.0 ; gen_tok_s=38.09 |
| llama-bench | ok | pp512=183.75 ; pp2048=232.65 ; tg128=60.60 |
| humaneval+ | ok | base=0.140 ; plus=0.140 |

Overall: Unsloth Gemma 4 E4B IT Q4_K_M on the OLD PC GTX 1660 Ti (6 GiB) via llama.cpp. Native llama-bench is the publishable GGUF speed number (pp512 184 tok/s, pp2048 233 tok/s, tg128 61 tok/s, `-ngl 99`). Smoke passed 6/6 with inferred full GPU residency (~3.2 GiB VRAM, above the 2000 MiB floor, generation well above 12 tok/s). HumanEval+ greedy pass@1 is 0.140 Base and 0.140 Plus on all 164 tasks in Docker; 119 completions were empty after sanitization, so this is a Q4 1660 Ti chat-served score, not a full-precision card figure, and not LiveCodeBench v6.
