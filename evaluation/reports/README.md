Human-readable and JSON reports are written to `evaluation/output/` (gitignored) and uploaded as MLflow artifacts.

Import Cursor-manual or human JSON with:

```bash
bash new-vm/scripts/run-evaluation.sh import-cursor-review --run-id RUN_ID --file cursor-results.json
bash new-vm/scripts/run-evaluation.sh import-human-review --run-id RUN_ID --file human-results.json
```
