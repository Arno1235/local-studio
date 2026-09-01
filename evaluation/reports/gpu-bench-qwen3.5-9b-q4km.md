# GPU bench report

Fill every field. Use `n/a` or `blocked` plus a reason. Never leave a section out. Never put API keys, tokens, or `.env` values in this file.

```yaml
schema: gpu-bench-v1
run_utc: 2026-09-01T01:26:24Z
git_sha: "d11d4ba9cadaae5eb7bacc9683f08c4d7438fa1c"
status_overall: ok
operator: cursor-new-vm
```

## 0. Identity

| Field | Value |
| --- | --- |
| hf_repo | unsloth/Qwen3.5-9B-GGUF |
| gguf_filename | Qwen3.5-9B-Q4_K_M.gguf |
| gguf_path_old_pc | /home/anon/.local/share/local-studio/models/unsloth/Qwen3.5-9B-GGUF/Qwen3.5-9B-Q4_K_M.gguf |
| served_model_name | qwen3.5-9b-q4km |
| recipe_id | qwen3.5-9b-q4km |
| quantization | Q4_K_M |
| backend | llamacpp |
| engine_binary | /home/anon/.local/share/local-studio/data/runtime/llamacpp/src/build/bin/llama-server |
| engine_version | 0.1.2-dev (llama-bench build 07822bd) |
| max_model_len | 8192 |
| max_num_seqs | 1 |
| temperature | 0 |
| seed | 42 |
| max_new_tokens_evalplus | 2048 (requested; evalplus 0.3.1 CLI has no `--max-new-tokens` flag; local runner set DecoderBase.max_new_tokens=2048) |
| controller_url | http://192.168.0.69:8080 |
| evalplus_version | 0.3.1 |

## 1. Hardware

| Field | Value |
| --- | --- |
| gpu_name | NVIDIA GeForce GTX 1660 Ti |
| vram_total_mb | 6144 |
| vram_used_mb_while_serving | 5362 (after first launch); later reloads 4936; smoke peak 5362 |
| vram_used_mb_after_evict | 1 |
| n_gpu_layers | all (recipe); llama-bench `-ngl 99` |
| offloaded_layers | unknown |
| total_layers | unknown |
| cpu_offloaded_layers | unknown |
| full_gpu_residency | true |
| notes | Residency inferred from telemetry (VRAM ~5.4 GiB used of 6 GiB, recipe `n-gpu-layers: all`, CUDA). llama.cpp offload log line was not in controller logs. llama-bench stderr: 1660 Ti has no tensor cores (compute 7.5). GGUF reports 8.954e9 params / 5669554176 bytes. OLD PC system RAM is 5.8 GiB; the controller process died several times during HumanEval codegen (OOM-adjacent pressure, no dmesg OOM line) and was restarted via user systemd `local-studio-controller.service`. |

## 2. Setup

| Step | status (`ok` / `skipped` / `blocked` / `failed`) | notes |
| --- | --- | --- |
| health | ok | Frontend, MLflow, controller `/health`, `/gpus` (1660 Ti, idle 1 MiB). `/v1/models` listed stopped `gemma-4-e4b-it-q4km` only. health.sh completion check still targets Gemma and returned 503; not fatal. |
| download | skipped | GGUF already on the OLD PC (`studio/models` listed `Qwen3.5-9B-GGUF`, 5680522464 bytes, matching HF `Qwen3.5-9B-Q4_K_M.gguf`). `/studio/downloads` was empty. |
| recipe | ok | Created `qwen3.5-9b-q4km` (llamacpp, port 8081, `n-gpu-layers: all`, jinja, verbose, max_num_seqs 1, context 8192). `llama-server` from `/runtime/llamacpp`. |
| evict | ok | Idle VRAM 1 MiB in 0.97 s. |
| llama_bench_ssh | ok | Native `llama-bench` over password SSH. First CLI run finished SSH then crashed on `POST /launch` (`RemoteDisconnected`) before writing artifacts. Retry with `--no-reload` wrote artifacts. |
| launch | ok | After bench, `POST /launch/qwen3.5-9b-q4km` often dropped the HTTP connection (timeout / empty reply) while the process still started. |
| wait_ready | ok | `/wait-ready?timeout=600` returned `ready: true` (elapsed 23 s after the first post-bench launch). `/v1/models` listed `qwen3.5-9b-q4km` with `active: true`. |
| pong_probe | ok | `max_tokens` 64 filled `reasoning_content` and left `content` empty (`finish_reason=length`). At `max_tokens` 256, `content` was `pong`. |

Download id (if any): n/a
Recipe created this run (`yes` / `no`): yes

## 3. llama-bench (OLD PC via SSH)

Native llama.cpp `llama-bench` on the GPU host. Password SSH from the NEW VM. Never record the password.

```yaml
status: ok
method: llama-bench-ssh
command: bash new-vm/scripts/run-evaluation.sh llama-bench --config evaluation/configs/qwen3.5-9b-q4km.yaml
ssh_user: "anon"
ssh_host: "192.168.0.69"
binary: "/home/anon/.local/share/local-studio/data/runtime/llamacpp/src/build/bin/llama-bench"
mlflow_run_id: "3cc73d8064594497af20d3fb37fb933b"
```

### Results (tok/s)

| test | mean_tok_s | stdev | n_prompt | n_gen |
| --- | --- | --- | --- | --- |
| pp512 | 64.577069 | 23.43806 | 512.0 | 0.0 |
| pp2048 | 128.964518 | 39.123694 | 2048.0 | 0.0 |
| tg128 | 41.490824 | 0.715737 | 0.0 | 128.0 |

Comparability: same flags as typical GGUF posts (`-ngl 99`, pp 512/2048, tg 128). Quant and GPU still have to match for a fair comparison.

Block/fail reason (if not `ok`): n/a

Copied from `evaluation/output/llama-bench-qwen3.5-9b-q4km.md`:

- Status: **ok**
- Host: `192.168.0.69` user `anon`
- Binary: `/home/anon/.local/share/local-studio/data/runtime/llamacpp/src/build/bin/llama-bench`
- GGUF: `/home/anon/.local/share/local-studio/models/unsloth/Qwen3.5-9B-GGUF/Qwen3.5-9B-Q4_K_M.gguf`

## 4. Smoke pipe (lab suite, not HumanEval)

```yaml
status: ok
suite: smoke
dataset: v1
config: evaluation/configs/qwen3.5-9b-q4km.yaml
mlflow_run_id: "a49b004f525d48779e781744620a6f25"
mlflow_experiment: local-llm-performance
```

| metric | value |
| --- | --- |
| status | ok |
| n_samples | 6 |
| n_deterministic_pass | 5 |
| deterministic_pass_rate | 0.8333333333333334 |
| mean_ttft_s | 1.7522478221666233 |
| mean_latency_s | 9.965054325666605 |
| mean_prompt_tokens_per_sec | 74.65825890573831 |
| mean_generation_tokens_per_sec | 38.08106111755638 |
| prompt_tokens | 140.0 |
| completion_tokens | 1662.0 |
| errors | 0 |
| timeouts | 0 |
| peak_vram_mb | 5362.0 |
| wall_s | 65.37234686800002 |
| gpu_fit | pass (failed=false, full_gpu_residency=true, inferred) |
| gpu_fit_reasons | llama.cpp layer-offload log was not available; residency inferred from telemetry |

Per-case automatic pass:

| test_id | category | automatic_pass | error |
| --- | --- | --- | --- |
| smoke-math-001 | mathematics | true | null |
| smoke-fact-001 | factual-qa | true | null |
| smoke-json-001 | extraction | true | null |
| smoke-instr-001 | instruction-following | true | null |
| smoke-code-001 | coding | false | null (empty `content`; 512 reasoning tokens, `truncated_before_answer`) |
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
samples_path: evaluation/output/evalplus/humaneval/qwen3.5-9b-q4km_openai_temp_0.0.jsonl
```

| metric | value |
| --- | --- |
| tasks_completed | 164 / 164 |
| humaneval_base_pass@1 | 0.933 |
| humaneval_plus_pass@1 | 0.896 |
| wall_s | 15658 (codegen 21:04:01Z–01:24:59Z, includes controller outages); evaluate 63 s |
| truncated_or_empty_completions | 5 / 164 empty in both sanitized and raw jsonl (HumanEval/36, 76, 118, 145, 160) |
| notes | evalplus 0.3.1 Fire CLI has no `--max-new-tokens`; codegen used max_tokens=2048 via a local venv wrapper (also raised the OpenAI client 100 s alarm to 600 s). Controller/llama-server dropped several times (at ~24, 51, 78, 104, 155/164); recipe relaunched; codegen resumed from jsonl. Docker image `ganler/evalplus:latest` digest sha256:26b118098bef281fe8dfe999bf05f1d5b45374b4e6c00161ec0f30592aef4740. Base 153/164 pass, Plus 147/164 pass. |

Stdout excerpt (the `Base` / `Base + Extra` dicts):

```
humaneval (base tests)
pass@1:	0.933
humaneval+ (base + extra tests)
pass@1:	0.896
```

Comparability notes:

- Report both Base (original HumanEval) and Plus (HumanEval+ extra tests).
- Official Gemma 4 E4B card publishes LiveCodeBench v6, not HumanEval. Do not treat Plus pass@1 as that card number.
- Q4_K_M + 8k context + llama.cpp on a 1660 Ti is expected to score below full-precision card figures.

## 6. Summary

| bench | status | headline |
| --- | --- | --- |
| smoke | ok | pass_rate=0.833 ; gen_tok_s=38.08 |
| llama-bench | ok | pp512=64.58 ; pp2048=128.96 ; tg128=41.49 |
| humaneval+ | ok | base=0.933 ; plus=0.896 |

Overall: Unsloth Qwen3.5 9B Q4_K_M on the OLD PC GTX 1660 Ti (6 GiB) via llama.cpp. Native llama-bench is the publishable GGUF speed number (pp512 65 tok/s, pp2048 129 tok/s, tg128 41 tok/s, `-ngl 99`). Smoke passed GPU-fit with inferred full GPU residency (~5.4 GiB VRAM, above the 2000 MiB floor, generation well above 12 tok/s) and 5/6 automatic cases; the coding case truncated in reasoning at 512 tokens. HumanEval+ greedy pass@1 is 0.933 Base and 0.896 Plus on all 164 tasks in Docker (153/164 and 147/164); 5 completions were empty. This is a Q4 1660 Ti chat-served score, not a full-precision card figure, and not LiveCodeBench v6.
