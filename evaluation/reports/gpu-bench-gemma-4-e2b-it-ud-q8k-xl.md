# GPU bench report

Fill every field. Use `n/a` or `blocked` plus a reason. Never leave a section out. Never put API keys, tokens, or `.env` values in this file.

```yaml
schema: gpu-bench-v1
run_utc: 2026-09-01T17:25:27Z
git_sha: "b5f587a466e693dbc21a070615e70fd1c659d524"
status_overall: ok
operator: cursor-new-vm
```

## 0. Identity

| Field | Value |
| --- | --- |
| hf_repo | unsloth/gemma-4-E2B-it-GGUF |
| gguf_filename | gemma-4-E2B-it-UD-Q8_K_XL.gguf |
| gguf_path_old_pc | /home/anon/.local/share/local-studio/models/unsloth/gemma-4-E2B-it-GGUF/gemma-4-E2B-it-UD-Q8_K_XL.gguf |
| served_model_name | gemma-4-e2b-it-ud-q8k-xl |
| recipe_id | gemma-4-e2b-it-ud-q8k-xl |
| quantization | UD-Q8_K_XL |
| backend | llamacpp |
| engine_binary | /home/anon/.local/share/local-studio/data/runtime/llamacpp/src/build/bin/llama-server |
| engine_version | 0.1.2-dev (llama-bench build 07822bd) |
| max_model_len | 8192 |
| max_num_seqs | 1 |
| temperature | 0 |
| seed | 42 |
| max_new_tokens_evalplus | 2048 (requested; evalplus 0.3.1 CLI has no `--max-new-tokens` flag; applied via gitignored venv wrapper) |
| controller_url | http://192.168.0.69:8080 |
| evalplus_version | 0.3.1 |

## 1. Hardware

| Field | Value |
| --- | --- |
| gpu_name | NVIDIA GeForce GTX 1660 Ti |
| vram_total_mb | 6144 |
| vram_used_mb_while_serving | 2922 (after launch); smoke peak 2936; after HumanEval+ 2948 |
| vram_used_mb_after_evict | 1 |
| n_gpu_layers | all (recipe); llama-bench `-ngl 99` |
| offloaded_layers | unknown |
| total_layers | unknown |
| cpu_offloaded_layers | unknown |
| full_gpu_residency | true |
| notes | Residency inferred from telemetry (VRAM ~2.9 GiB used, recipe `n-gpu-layers: all`, CUDA). llama.cpp offload log line was not in controller logs. llama-bench: 4.647e9 params / 5266987148 bytes, model_type `gemma4 E2B Q8_0`, n_cpu_moe 0. 1660 Ti has no tensor cores (compute 7.5). OLD PC system RAM is 5.8 GiB. |

## 2. Setup

| Step | status (`ok` / `skipped` / `blocked` / `failed`) | notes |
| --- | --- | --- |
| health | ok | Frontend/MLflow/controller were up. First health.sh completion probe used the default `gemma-4-e4b-it-q4km` name and got 503 because Qwen 3.5 9B was the active recipe. |
| download | skipped | GGUF already on the OLD PC (`studio/models` listed `gemma-4-E2B-it-GGUF`, 8389546176 bytes = UD-Q8_K_XL 5282807904 + Q4_K_M 3106738272). `/studio/downloads` was empty. |
| recipe | ok | Created `gemma-4-e2b-it-ud-q8k-xl` (llamacpp, port 8081, `n-gpu-layers: all`, jinja, verbose, max_num_seqs 1, context 8192). llama-server ref from `/runtime/llamacpp`. |
| evict | ok | Idle VRAM 1 MiB in 0.51 s. |
| llama_bench_ssh | ok | Native `llama-bench` over password SSH. First CLI run finished SSH then crashed on `POST /launch` (`RemoteDisconnected`) before writing artifacts. Retry with `--no-reload` wrote artifacts. |
| launch | ok | After `--no-reload` bench, `POST /launch/gemma-4-e2b-it-ud-q8k-xl` returned `Launch started` (~84 s including wait-ready). |
| wait_ready | ok | `/wait-ready?timeout=600` returned `ready: true`. `/v1/models` listed `gemma-4-e2b-it-ud-q8k-xl` with `active: true`. |
| pong_probe | ok | `content` was `pong` at `max_tokens` 64. |

Download id (if any): n/a
Recipe created this run (`yes` / `no`): yes

## 3. llama-bench (OLD PC via SSH)

Native llama.cpp `llama-bench` on the GPU host. Password SSH from the NEW VM. Never record the password.

```yaml
status: ok
method: llama-bench-ssh
command: bash new-vm/scripts/run-evaluation.sh llama-bench --config evaluation/configs/gemma-4-e2b-it-ud-q8k-xl.yaml
ssh_user: "anon"
ssh_host: "192.168.0.69"
binary: "/home/anon/.local/share/local-studio/data/runtime/llamacpp/src/build/bin/llama-bench"
mlflow_run_id: "df0be64cded3451ba55e65237c593a38"
```

### Results (tok/s)

| test | mean_tok_s | stdev | n_prompt | n_gen |
| --- | --- | --- | --- | --- |
| pp512 | 210.540561 | 55.32914 | 512.0 | 0.0 |
| pp2048 | 224.024837 | 36.35042 | 2048.0 | 0.0 |
| tg128 | 64.582349 | 0.639558 | 0.0 | 128.0 |

Comparability: same flags as typical GGUF posts (`-ngl 99`, pp 512/2048, tg 128). Quant and GPU still have to match for a fair comparison.

Block/fail reason (if not `ok`): n/a

Copied from `evaluation/output/llama-bench-gemma-4-e2b-it-ud-q8k-xl.md`:

- Status: **ok**
- Host: `192.168.0.69` user `anon`
- Binary: `/home/anon/.local/share/local-studio/data/runtime/llamacpp/src/build/bin/llama-bench`
- GGUF: `/home/anon/.local/share/local-studio/models/unsloth/gemma-4-E2B-it-GGUF/gemma-4-E2B-it-UD-Q8_K_XL.gguf`

## 4. Smoke pipe (lab suite, not HumanEval)

```yaml
status: ok
suite: smoke
dataset: v1
config: evaluation/configs/gemma-4-e2b-it-ud-q8k-xl.yaml
mlflow_run_id: "a0254688591a4b8398654a6aaff5c8f1"
mlflow_experiment: local-llm-performance
```

| metric | value |
| --- | --- |
| status | ok |
| n_samples | 6 |
| n_deterministic_pass | 6 |
| deterministic_pass_rate | 1.0 |
| mean_ttft_s | 1.1285687986698274 |
| mean_latency_s | 3.00450565633461 |
| mean_prompt_tokens_per_sec | 121.46690197393184 |
| mean_generation_tokens_per_sec | 58.879208865407804 |
| prompt_tokens | 178.0 |
| completion_tokens | 447.0 |
| errors | 0 |
| timeouts | 0 |
| peak_vram_mb | 2936.0 |
| wall_s | 23.37915037300263 |
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
samples_path: evaluation/output/evalplus/humaneval/gemma-4-e2b-it-ud-q8k-xl_openai_temp_0.0.jsonl
```

| metric | value |
| --- | --- |
| tasks_completed | 164 / 164 |
| humaneval_base_pass@1 | 0.841 |
| humaneval_plus_pass@1 | 0.787 |
| wall_s | 4610 codegen (16:06:51Z–17:23:56Z, no controller outage) + 62 evaluate |
| truncated_or_empty_completions | 9 / 164 empty in both sanitized and raw jsonl (HumanEval/10, 40, 84, 86, 113, 116, 130, 132, 147) |
| notes | evalplus 0.3.1 Fire CLI has no `--max-new-tokens`; codegen used max_tokens=2048 via a local venv wrapper (also raised the OpenAI client 100 s alarm to 600 s). Progress bar 1:16:50 for 164/164. Docker image `ganler/evalplus:latest` digest sha256:26b118098bef281fe8dfe999bf05f1d5b45374b4e6c00161ec0f30592aef4740. Base 138/164 pass, Plus 129/164 pass. |

Stdout excerpt (the `Base` / `Base + Extra` dicts):

```
humaneval (base tests)
pass@1:	0.841
humaneval+ (base + extra tests)
pass@1:	0.787
```

Comparability notes:

- Report both Base (original HumanEval) and Plus (HumanEval+ extra tests).
- Official Gemma 4 E4B card publishes LiveCodeBench v6, not HumanEval. Do not treat Plus pass@1 as that card number.
- UD-Q8_K_XL + 8k context + llama.cpp on a 1660 Ti is expected to score below full-precision card figures.

## 6. Summary

| bench | status | headline |
| --- | --- | --- |
| smoke | ok | pass_rate=1.0 ; gen_tok_s=58.88 |
| llama-bench | ok | pp512=210.54 ; pp2048=224.02 ; tg128=64.58 |
| humaneval+ | ok | base=0.841 ; plus=0.787 |

Overall: Unsloth Gemma 4 E2B IT UD-Q8_K_XL on the OLD PC GTX 1660 Ti (6 GiB) via llama.cpp. Native llama-bench is the publishable GGUF speed number (pp512 211 tok/s, pp2048 224 tok/s, tg128 65 tok/s, `-ngl 99`). Smoke passed 6/6 with inferred full GPU residency (~2.9 GiB VRAM, above the 2000 MiB floor, generation well above 12 tok/s). HumanEval+ greedy pass@1 is 0.841 Base and 0.787 Plus on all 164 tasks in Docker (138/164 and 129/164); 9 completions were empty after sanitization. This is a UD-Q8_K_XL 1660 Ti chat-served score, not a full-precision card figure, and not LiveCodeBench v6.
