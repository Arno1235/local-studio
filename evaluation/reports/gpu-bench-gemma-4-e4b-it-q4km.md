# GPU bench report

Fill every field. Use `n/a` or `blocked` plus a reason. Never leave a section out. Never put API keys, tokens, or `.env` values in this file.

```yaml
schema: gpu-bench-v1
run_utc: 2026-09-01T22:27:14Z
git_sha: "ee4889437e13fcd8b42c0674d726495ccfd9f964"
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
| max_new_tokens_evalplus | 2048 (applied: gitignored Python wrapper set DecoderBase.max_new_tokens=2048 and remapped OpenAI SIGALRM 100→600; evalplus 0.3.1 Fire has no --max-new-tokens; CLI flag was NOT used) |
| controller_url | http://192.168.0.69:8080 |
| evalplus_version | 0.3.1 |

## 1. Hardware

| Field | Value |
| --- | --- |
| gpu_name | NVIDIA GeForce GTX 1660 Ti |
| vram_total_mb | 6144 |
| vram_used_mb_while_serving | 3258 (after launch); smoke peak 3272; after HumanEval+ 3280 |
| vram_used_mb_after_evict | 1 |
| n_gpu_layers | all (recipe); llama-bench `-ngl 99` |
| offloaded_layers | unknown |
| total_layers | unknown |
| cpu_offloaded_layers | unknown |
| full_gpu_residency | true |
| notes | Residency inferred from telemetry (VRAM ~3.2 GiB used, recipe `n-gpu-layers: all`, CUDA). llama.cpp offload log line was not in controller logs. llama-bench stderr: 1660 Ti has no tensor cores (compute 7.5). GGUF reports 7.518e9 params / 4961343656 bytes. OLD PC system RAM is 5.8 GiB. This HumanEval+ retry is the same Q4_K_M recipe and 8192 context as the 2026-08-30 run. |

## 2. Setup

| Step | status (`ok` / `skipped` / `blocked` / `failed`) | notes |
| --- | --- | --- |
| health | ok | Frontend/MLflow/controller were up. GPU was NVIDIA GeForce GTX 1660 Ti, idle 1 MiB. All recipes `stopped` at start; health.sh completion probe 503 until launch (not fatal). |
| download | skipped | GGUF already on the OLD PC (`studio/models` listed `gemma-4-E4B-it-GGUF`, 4977171584 bytes). `/studio/downloads` was empty. |
| recipe | skipped | Reused existing `gemma-4-e4b-it-q4km` (llamacpp, port 8081, `n-gpu-layers: all`, jinja, verbose, max_num_seqs 1, context 8192). No thinking kwargs patched. |
| evict | ok | Idle VRAM 1 MiB; no foreign recipe was active. |
| llama_bench_ssh | skipped | reused 2026-08-30T20:59:01Z report; HumanEval+ retry only |
| launch | ok | `POST /launch/gemma-4-e4b-it-q4km` dropped (`Empty reply from server`) while llama-server still started. Same pattern on the post-outage relaunch. |
| wait_ready | ok | `/wait-ready?timeout=600` returned `ready: true` (elapsed 24 s first launch; 12 s after controller restart). `/v1/models` listed `gemma-4-e4b-it-q4km` with `active: true`. |
| pong_probe | ok | `content` was `pong` at `max_tokens` 64. Repeat after controller restart also returned `pong` at 64. |

Download id (if any): n/a
Recipe created this run (`yes` / `no`): no

## 3. llama-bench (OLD PC via SSH)

Native llama.cpp `llama-bench` on the GPU host. Password SSH from the NEW VM. Never record the password.

```yaml
status: skipped
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

Block/fail reason (if not `ok`): skipped; reused 2026-08-30T20:59:01Z report; HumanEval+ retry only. Speed numbers were already valid and were not re-measured.

Copied from `evaluation/output/llama-bench-gemma-4-e4b-it-q4km.md`:

- Status: **ok** (prior run)
- Host: `192.168.0.69` user `anon`
- Binary: `/home/anon/.local/share/local-studio/data/runtime/llamacpp/src/build/bin/llama-bench`
- GGUF: `/home/anon/.local/share/local-studio/models/unsloth/gemma-4-E4B-it-GGUF/gemma-4-E4B-it-Q4_K_M.gguf`

## 4. Smoke pipe (lab suite, not HumanEval)

```yaml
status: ok
suite: smoke
dataset: v1
config: evaluation/configs/gemma-4-e4b-it-q4km.yaml
mlflow_run_id: "2903930f4c484d969e6be5281e678f0e"
mlflow_experiment: local-llm-performance
```

| metric | value |
| --- | --- |
| status | ok |
| n_samples | 6 |
| n_deterministic_pass | 6 |
| deterministic_pass_rate | 1.0 |
| mean_ttft_s | 3.9710463833333356 |
| mean_latency_s | 4.601546802833316 |
| mean_prompt_tokens_per_sec | 64.57735271608131 |
| mean_generation_tokens_per_sec | 35.587279546010535 |
| prompt_tokens | 178.0 |
| completion_tokens | 77.0 |
| errors | 0 |
| timeouts | 0 |
| peak_vram_mb | 3272.0 |
| wall_s | 34.42068820099985 |
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
| humaneval_base_pass@1 | 0.902 |
| humaneval_plus_pass@1 | 0.854 |
| wall_s | 8343 codegen (20:06:21Z–22:25:24Z, includes controller outage) + 63 evaluate |
| truncated_or_empty_completions | 4 / 164 empty in both sanitized and raw jsonl (HumanEval/76, 116, 130, 147) |
| notes | This run supersedes the invalid 2026-08-30 HumanEval+ of base=0.140 plus=0.140 with 119/164 empty rows. That score used EvalPlus 0.3.1 Fire leftover `--max-new-tokens`, which is not a `run_codegen` parameter; generation used DecoderBase default (512/768) then Fire exited 2. Old jsonl archived to `evaluation/output/evalplus/humaneval/archive-max512-20260901T200500Z` before codegen so resume could not reuse 512-token empties. This retry applied max_new_tokens=2048 via gitignored wrapper `evaluation/output/run_evalplus_codegen_max2048.py` (logged `WRAPPER DecoderBase name='gemma-4-e4b-it-q4km' max_new_tokens=2048`; SIGALRM 100→600). Fire CLI `--max-new-tokens` was not passed. Preflight chat (system+user, same as EvalPlus): A max_tokens=512 finish_reason=stop content_empty=false reasoning_nonempty=true completion_tokens=356 (content had `def add`); B max_tokens=2048 same. Controller bun entered D-state around HumanEval/114 (~21:01Z); llama-server port 8081 closed; HTTP /health timed out. User systemd `local-studio-controller.service` restarted via Paramiko; recipe relaunched; codegen resumed from the **new** jsonl at HumanEval/114 (not the archive). Last resume stretch progress bar 0:29:50 for remaining tasks. Docker image `ganler/evalplus:latest` digest sha256:26b118098bef281fe8dfe999bf05f1d5b45374b4e6c00161ec0f30592aef4740. Base 148/164 pass, Plus 140/164 pass. |

Stdout excerpt (the `Base` / `Base + Extra` dicts):

```
humaneval (base tests)
pass@1:	0.902
humaneval+ (base + extra tests)
pass@1:	0.854
```

Comparability notes:

- Report both Base (original HumanEval) and Plus (HumanEval+ extra tests).
- Official Gemma 4 E4B card publishes LiveCodeBench v6, not HumanEval. Do not treat Plus pass@1 as that card number.
- Q4_K_M + 8k context + llama.cpp on a 1660 Ti is expected to score below full-precision card figures.
- This retry uses the same 2048-token OpenAI-backend protocol as `gpu-bench-qwen3.5-9b-q4km.md` and `gpu-bench-gemma-4-e2b-it-ud-q8k-xl.md` (DecoderBase.max_new_tokens=2048 in a gitignored venv wrapper; no Fire `--max-new-tokens`; scores `message.content` only, not `reasoning_content`). Still not LiveCodeBench v6. Still Q4_K_M on a 1660 Ti.
- The first published 0.140 / 0.140 with 119 empties is invalid and superseded.

## 6. Summary

| bench | status | headline |
| --- | --- | --- |
| smoke | ok | pass_rate=1.0 ; gen_tok_s=35.59 |
| llama-bench | skipped | pp512=183.75 ; pp2048=232.65 ; tg128=60.60 (reused 2026-08-30) |
| humaneval+ | ok | base=0.902 ; plus=0.854 |

Overall: HumanEval+ retry of Unsloth Gemma 4 E4B IT Q4_K_M on the OLD PC GTX 1660 Ti (6 GiB) via llama.cpp, same recipe and 8192 context as the first run. Native llama-bench was not repeated; the publishable GGUF speed number remains pp512 184 tok/s, pp2048 233 tok/s, tg128 61 tok/s (`-ngl 99`). Smoke this retry passed 6/6 with inferred full GPU residency (~3.2 GiB VRAM, above the 2000 MiB floor, generation well above 12 tok/s). The first HumanEval+ 0.140 Base/Plus is superseded: EvalPlus 0.3.1 Fire never applied `--max-new-tokens`, thinking ate the short budget, and 119/164 completions were empty. With DecoderBase.max_new_tokens actually 2048, greedy pass@1 is 0.902 Base and 0.854 Plus on all 164 tasks in Docker (148/164 and 140/164); 4 completions were empty after sanitization. This is now the same 2048-token chat-served protocol as the Qwen 3.5 9B Q4_K_M and Gemma 4 E2B UD-Q8_K_XL reports, not a full-precision card figure, and not LiveCodeBench v6.
