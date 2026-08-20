from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from llm_lab_eval.config import EVAL_ROOT


def write_reports(payload: dict[str, Any]) -> list[Path]:
    out_dir = EVAL_ROOT / "output"
    out_dir.mkdir(parents=True, exist_ok=True)
    run_id = payload.get("run_id") or "local"
    json_path = out_dir / f"report-{run_id}.json"
    md_path = out_dir / f"report-{run_id}.md"
    json_path.write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(payload), encoding="utf-8")
    return [json_path, md_path]


def render_markdown(payload: dict[str, Any]) -> str:
    gpu = payload.get("gpu_fit") or {}
    summary = payload.get("summary") or {}
    cfg = payload.get("config") or {}
    items = payload.get("items") or []
    lines = [
        "# LLM lab evaluation report",
        "",
        f"- Status: **{payload.get('status')}**",
        f"- MLflow run: `{payload.get('run_id')}`",
        f"- Model: `{cfg.get('model.name')}` ({cfg.get('model.quantization')})",
        f"- Backend: `{cfg.get('model.backend')}`",
        f"- Endpoint: `{cfg.get('model.endpoint')}`",
        f"- Dataset: `{cfg.get('evaluation.dataset_version')}` suite `{cfg.get('evaluation.suite')}`",
        f"- Git SHA: `{cfg.get('git.sha')}`",
        "",
        "## Hardware / GPU fit",
        "",
        f"- GPU: {gpu.get('gpu_name')} ({gpu.get('vram_used_mb')} / {gpu.get('vram_total_mb')} MiB)",
        f"- Full GPU residency: {gpu.get('full_gpu_residency')} (verified={gpu.get('full_gpu_residency_verified')}, inferred={gpu.get('full_gpu_residency_inferred')})",
        f"- Offloaded layers: {gpu.get('offloaded_layers')}/{gpu.get('total_layers')} (CPU-offloaded={gpu.get('cpu_offloaded_layers')})",
        f"- llama.cpp: {gpu.get('llama_version')}",
        f"- Local Studio: {gpu.get('app_version')}",
        f"- Context: {gpu.get('context_length')}",
    ]
    if gpu.get("reasons"):
        lines.append("- Warnings / failures:")
        for reason in gpu["reasons"]:
            lines.append(f"  - {reason}")
    lines += [
        "",
        "## Performance (automatic)",
        "",
        f"- Samples: {summary.get('n_samples')}",
        f"- Mean TTFT: {summary.get('mean_ttft_s')}",
        f"- Mean latency: {summary.get('mean_latency_s')}",
        f"- Prompt tok/s: {summary.get('mean_prompt_tokens_per_sec')}",
        f"- Generation tok/s: {summary.get('mean_generation_tokens_per_sec')}",
        f"- Prompt tokens: {summary.get('prompt_tokens')}",
        f"- Output tokens: {summary.get('completion_tokens')}",
        f"- Errors / timeouts: {summary.get('errors')} / {summary.get('timeouts')}",
        f"- Peak VRAM: {summary.get('peak_vram_mb')} MiB",
        "",
        "## Deterministic quality",
        "",
        f"- Graded samples: {summary.get('n_deterministic')}",
        f"- Pass: {summary.get('n_deterministic_pass')}",
        f"- Pass rate: {summary.get('deterministic_pass_rate')}",
        "",
        "## Efficiency",
        "",
        "These are ratios, not a composite score:",
        "",
        "- `generation_tokens_per_sec` = completion tokens / generation seconds (llama.cpp `predicted_per_second` when present).",
        "- `prompt_tokens_per_sec` = prompt tokens / prefill seconds (llama.cpp `prompt_per_second` when present).",
        "- `successful_tasks_per_generated_token` = deterministic passes / total completion tokens.",
        "- Quality-per-token is recorded only after Cursor-manual or human scores are imported (`quality.mean_score / auto.completion_tokens`).",
        "",
        f"- successful_tasks_per_generated_token: {summary.get('successful_tasks_per_generated_token')}",
        "",
        "## Semantic quality",
        "",
        "Automatic runs do not call an LLM judge. Import Cursor-manual JSON or a human review to attach semantic scores. Cloud judges are not configured.",
        "",
        "## Cases",
        "",
    ]
    for item in items:
        score = item.get("score") or {}
        lines.append(
            f"- `{item.get('test_id')}` ({item.get('category')}): pass={score.get('automatic_pass')} "
            f"latency={((item.get('metrics') or {}).get('latency_s'))}s"
        )
        if item.get("error"):
            lines.append(f"  - error: {item['error']}")
    lines.append("")
    return "\n".join(lines)
