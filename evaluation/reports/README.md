Human-readable and JSON reports from the in-repo lab CLI are written to `evaluation/output/` (gitignored) and uploaded as MLflow artifacts.

Unattended GPU benches (smoke + llama-bench + EvalPlus HumanEval+) write a single comparable markdown file here:

- Prompt to paste into Cursor on the NEW VM: [`../prompts/run-gpu-bench.md`](../prompts/run-gpu-bench.md)
- Report schema: [`TEMPLATE-gpu-bench.md`](TEMPLATE-gpu-bench.md)
- Filled reports: `gpu-bench-<served_model_name>.md`

Import Cursor-manual or human JSON with:

```bash
bash new-vm/scripts/run-evaluation.sh import-cursor-review --run-id RUN_ID --file cursor-results.json
bash new-vm/scripts/run-evaluation.sh import-human-review --run-id RUN_ID --file human-results.json
```
