# Evaluation prompts

Cursor prompts for unattended GPU benches on the NEW VM. Inference stays on the OLD PC.

| File | Use |
| --- | --- |
| [run-gpu-bench.md](run-gpu-bench.md) | Paste into Cursor on the NEW VM. Fill the Model card first. No SSH to the OLD PC. |

The run writes `evaluation/reports/gpu-bench-<served_model_name>.md` using [../reports/TEMPLATE-gpu-bench.md](../reports/TEMPLATE-gpu-bench.md).
