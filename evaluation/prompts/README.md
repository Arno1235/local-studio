# Evaluation prompts

Cursor prompts for unattended GPU benches on the NEW VM. Inference stays on the OLD PC.

| File | Use |
| --- | --- |
| [run-gpu-bench-gemma-4-e4b-it-q4km.md](run-gpu-bench-gemma-4-e4b-it-q4km.md) | Gemma 4 E4B IT Q4_K_M. Paste into Cursor on the NEW VM. SSH user/password come from `.env` or the card. |
| [run-gpu-bench-qwen3.5-9b-q4km.md](run-gpu-bench-qwen3.5-9b-q4km.md) | Qwen3.5 9B Q4_K_M. Same prompt; Model card only differs. |
| [run-gpu-bench-gemma-4-e2b-it-ud-q8k-xl.md](run-gpu-bench-gemma-4-e2b-it-ud-q8k-xl.md) | Gemma 4 E2B IT UD-Q8_K_XL. Same prompt; Model card only differs. |

The run writes `evaluation/reports/gpu-bench-<served_model_name>.md` using [../reports/TEMPLATE-gpu-bench.md](../reports/TEMPLATE-gpu-bench.md), then commits and pushes that file to the remote.
