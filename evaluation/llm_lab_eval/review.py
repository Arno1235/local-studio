from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from llm_lab_eval.config import EVAL_ROOT

SCORE_KEYS = (
    "correctness",
    "relevance",
    "instruction_following",
    "completeness",
    "reasoning_quality",
    "factuality",
    "coding_quality",
    "structured_output_quality",
    "score",
)
ALLOWED_WINNERS = {"A", "B", "TIE", ""}


def _load_run_report(run_id: str) -> dict[str, Any]:
    path = EVAL_ROOT / "output" / f"report-{run_id}.json"
    if not path.is_file():
        raise SystemExit(f"missing evaluation report {path}; re-run evaluation or pass --report")
    return json.loads(path.read_text(encoding="utf-8"))


def generate_cursor_review(run_id: str, suite: str | None = None) -> Path:
    report = _load_run_report(run_id)
    items = report.get("items") or []
    if suite:
        pass
    rubric = (EVAL_ROOT / "rubrics" / "cursor-standard.yaml").read_text(encoding="utf-8")
    schema = json.loads((EVAL_ROOT / "schemas" / "cursor-review.schema.json").read_text(encoding="utf-8"))
    out_dir = EVAL_ROOT / "output" / f"cursor-review-{run_id}"
    out_dir.mkdir(parents=True, exist_ok=True)
    cases = []
    for item in items:
        cases.append(
            {
                "test_id": item.get("test_id"),
                "category": item.get("category"),
                "prompt": item.get("prompt"),
                "reference": item.get("reference"),
                "model_output": item.get("output"),
                "automatic": item.get("score"),
            }
        )
    package = {
        "evaluation_run_id": run_id,
        "suite": (report.get("config") or {}).get("evaluation.suite"),
        "model": (report.get("config") or {}).get("model.name"),
        "judge": "cursor-manual",
        "cases": cases,
        "schema": schema,
    }
    (out_dir / "cases.json").write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")
    prompt = []
    prompt.append("# Cursor manual semantic evaluation")
    prompt.append("")
    prompt.append("You are acting as an evaluator. Do not rewrite the model answers.")
    prompt.append("Score only. Return ONLY valid JSON that matches the schema. No markdown fences.")
    prompt.append("Do not modify test IDs. Do not omit test cases. Do not add extra keys or commentary.")
    prompt.append("")
    prompt.append("This review is operated manually in Cursor. There is no Cursor API integration.")
    prompt.append("")
    prompt.append("## Rubric")
    prompt.append("")
    prompt.append(rubric)
    prompt.append("")
    prompt.append("## Required JSON shape")
    prompt.append("")
    prompt.append("```json")
    prompt.append(
        json.dumps(
            {
                "evaluation_run_id": run_id,
                "judge": "cursor-manual",
                "results": [
                    {
                        "test_id": "<copy exactly>",
                        "winner": "A|B|TIE",
                        "correctness": 1,
                        "relevance": 1,
                        "instruction_following": 1,
                        "completeness": 1,
                        "reasoning_quality": 1,
                        "factuality": 1,
                        "coding_quality": 1,
                        "structured_output_quality": 1,
                        "score": 1,
                        "rationale": "one short sentence",
                    }
                ],
            },
            indent=2,
        )
    )
    prompt.append("```")
    prompt.append("")
    prompt.append("Scores are integers 1-5. Use null for a criterion that does not apply.")
    prompt.append("Winner is A (this model), B (unused in single-model runs), or TIE.")
    prompt.append("")
    prompt.append("## Cases")
    prompt.append("")
    for case in cases:
        prompt.append(f"### {case['test_id']} ({case.get('category')})")
        prompt.append("")
        prompt.append("Prompt:")
        prompt.append("")
        prompt.append(case.get("prompt") or "")
        prompt.append("")
        if case.get("reference"):
            prompt.append("Reference:")
            prompt.append("")
            prompt.append(str(case["reference"]))
            prompt.append("")
        prompt.append("Model output:")
        prompt.append("")
        prompt.append(case.get("model_output") or "")
        prompt.append("")
    text_path = out_dir / "CURSOR_PROMPT.md"
    text_path.write_text("\n".join(prompt) + "\n", encoding="utf-8")
    print(text_path)
    return text_path


def _validate_review(payload: dict[str, Any], report: dict[str, Any], expected_judge: str) -> list[dict[str, Any]]:
    errors: list[str] = []
    if payload.get("evaluation_run_id") != report.get("run_id"):
        errors.append(
            f"evaluation_run_id {payload.get('evaluation_run_id')} does not match {report.get('run_id')}"
        )
    if payload.get("judge") != expected_judge:
        errors.append(f"judge must be {expected_judge}, got {payload.get('judge')}")
    results = payload.get("results")
    if not isinstance(results, list) or not results:
        errors.append("results must be a non-empty array")
        raise SystemExit("invalid review:\n- " + "\n- ".join(errors))
    expected_ids = [item["test_id"] for item in report.get("items") or []]
    seen: set[str] = set()
    for row in results:
        test_id = row.get("test_id")
        if test_id in seen:
            errors.append(f"duplicate test_id {test_id}")
        seen.add(test_id)
        if test_id not in expected_ids:
            errors.append(f"unexpected test_id {test_id}")
        winner = row.get("winner") or ""
        if winner not in ALLOWED_WINNERS:
            errors.append(f"{test_id}: invalid winner {winner}")
        for key in SCORE_KEYS:
            value = row.get(key)
            if value is None:
                continue
            if not isinstance(value, int) or value < 1 or value > 5:
                errors.append(f"{test_id}: {key} must be an integer 1-5 or null")
        if not isinstance(row.get("rationale"), str) or not row.get("rationale").strip():
            errors.append(f"{test_id}: rationale required")
    missing = [test_id for test_id in expected_ids if test_id not in seen]
    if missing:
        errors.append("missing test ids: " + ", ".join(missing))
    if errors:
        raise SystemExit("invalid review:\n- " + "\n- ".join(errors))
    return results


def import_review(run_id: str, file_path: str, judge: str) -> None:
    import mlflow

    report = _load_run_report(run_id)
    payload = json.loads(Path(file_path).read_text(encoding="utf-8"))
    results = _validate_review(payload, report, judge)
    tracking = report.get("config") or {}
    uri = __import__("os").environ.get("MLFLOW_TRACKING_URI", "http://127.0.0.1:5000")
    mlflow.set_tracking_uri(uri)
    with mlflow.start_run(run_id=run_id):
        mlflow.set_tag(f"{judge}.imported", "true")
        mlflow.set_tag("semantic_source", judge)
        scores = [row.get("score") for row in results if isinstance(row.get("score"), int)]
        if scores:
            mlflow.log_metrics({f"{judge}.mean_score": sum(scores) / len(scores)})
            completion_tokens = (report.get("summary") or {}).get("completion_tokens")
            if completion_tokens:
                mlflow.log_metrics(
                    {f"{judge}.quality_per_output_token": (sum(scores) / len(scores)) / completion_tokens}
                )
        for row in results:
            prefix = f"{judge}.{row['test_id']}."
            logged = {}
            for key in SCORE_KEYS:
                if isinstance(row.get(key), int):
                    logged[prefix + key] = float(row[key])
            if logged:
                mlflow.log_metrics(logged)
        dest = EVAL_ROOT / "output" / f"{judge}-{run_id}.json"
        dest.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        mlflow.log_artifact(str(dest))
    print(f"imported {len(results)} {judge} rows into run {run_id}")
