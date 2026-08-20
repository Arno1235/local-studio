# Evaluation

Datasets, benchmark prompts, and generated reports for the distributed lab.

- `configs/backend-benchmark.json` — fixed prompts for the old-PC llama.cpp backend
- `benchmarks/` — extra benchmark definitions
- `datasets/` — evaluation corpora
- `reports/` — generated JSON (gitignored except `.gitkeep`)

Run the GPU backend benchmark from the old PC:

```bash
bash old-pc-backend/scripts/benchmark.sh
```
