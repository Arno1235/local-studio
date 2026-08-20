from __future__ import annotations

import json
import subprocess
import time
from typing import Any

from llm_lab_eval import CONFIG_VERSION, DATASET_VERSION, __version__
from llm_lab_eval.config import EVAL_ROOT, LabConfig
from llm_lab_eval.controller import ControllerClient
from llm_lab_eval.gpu_fit import evaluate_gpu_fit
from llm_lab_eval.http import stream_chat
from llm_lab_eval.scoring import score_item

EXPERIMENTS = {
    "performance": "local-llm-performance",
    "quality": "local-llm-quality",
    "comparisons": "local-llm-comparisons",
}


def git_sha() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=EVAL_ROOT.parent,
            text=True,
        ).strip()
    except Exception:
        return "unknown"


def load_suite(dataset: str, suite: str) -> dict[str, Any]:
    path = EVAL_ROOT / "datasets" / dataset / f"{suite}.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["path"] = str(path)
    return payload


def warn_cloud_judge(cfg: LabConfig, n_items: int) -> None:
    judge = cfg.evaluation.semantic_judge.strip().lower()
    print(f"semantic_judge={judge}")
    print(f"judged_sample_count={n_items}")
    print("cloud_judge_estimated_requests=0 (cursor-manual / automatic; no provider API)")
    if judge in {"cloud", "openai", "anthropic", "gemini", "mlflow-llm", "mlflow-genai"}:
        print(
            "Cloud LLM judges are disabled in this lab. Cursor subscription does not "
            "provide general-purpose API credits for MLflow judges. A separate provider "
            "API key/account is required and may incur API charges."
        )
        raise SystemExit(
            "refusing cloud semantic judge; use evaluation.semantic_judge: cursor-manual"
        )
    if cfg.evaluation.suite == "extended":
        print(
            "WARNING: extended suite has more samples and will take longer on the GTX 1660 Ti. "
            "It still does not call a paid cloud judge by default."
        )


def metrics_from_result(result: dict[str, Any]) -> dict[str, float]:
    usage = result.get("usage") or {}
    timings = result.get("timings") or {}
    prompt_tokens = float(usage.get("prompt_tokens") or timings.get("prompt_n") or 0)
    completion_tokens = float(usage.get("completion_tokens") or timings.get("predicted_n") or 0)
    total_tokens = float(usage.get("total_tokens") or (prompt_tokens + completion_tokens))
    latency = float(result.get("latency_s") or 0)
    ttft = result.get("ttft_s")
    prompt_ms = float(timings.get("prompt_ms") or 0)
    pred_ms = float(timings.get("predicted_ms") or 0)
    prompt_tps = timings.get("prompt_per_second")
    gen_tps = timings.get("predicted_per_second")
    if prompt_tps is None and prompt_ms > 0 and prompt_tokens:
        prompt_tps = prompt_tokens / (prompt_ms / 1000.0)
    if gen_tps is None and pred_ms > 0 and completion_tokens:
        gen_tps = completion_tokens / (pred_ms / 1000.0)
    if gen_tps is None and ttft is not None and latency > ttft and completion_tokens:
        gen_tps = completion_tokens / (latency - ttft)
    total_tps = total_tokens / latency if latency > 0 and total_tokens else None
    out = {
        "latency_s": latency,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
        "chunks": float(result.get("chunks") or 0),
        "error": 1.0 if result.get("error") else 0.0,
        "timeout": 1.0 if result.get("timeout") else 0.0,
    }
    if ttft is not None:
        out["ttft_s"] = float(ttft)
        out["ttft_ms"] = float(ttft) * 1000.0
    if prompt_tps is not None:
        out["prompt_tokens_per_sec"] = float(prompt_tps)
    if gen_tps is not None:
        out["generation_tokens_per_sec"] = float(gen_tps)
    if total_tps is not None:
        out["total_throughput_tokens_per_sec"] = float(total_tps)
    return out


def flatten_params(cfg: LabConfig, gpu: dict[str, Any], suite: dict[str, Any]) -> dict[str, Any]:
    return {
        "model.name": cfg.model.name,
        "model.revision": cfg.model.revision or "",
        "model.quantization": cfg.model.quantization,
        "model.endpoint": cfg.model.endpoint,
        "model.backend": cfg.model.backend,
        "model.path": gpu.get("model_path") or "",
        "generation.temperature": cfg.generation.temperature,
        "generation.top_p": cfg.generation.top_p,
        "generation.max_tokens": cfg.generation.max_tokens,
        "generation.context_length": cfg.generation.context_length,
        "generation.seed": cfg.generation.seed if cfg.generation.seed is not None else "",
        "evaluation.dataset": cfg.evaluation.dataset,
        "evaluation.suite": cfg.evaluation.suite,
        "evaluation.semantic_judge": cfg.evaluation.semantic_judge,
        "evaluation.config_version": CONFIG_VERSION,
        "evaluation.dataset_version": suite.get("version") or DATASET_VERSION,
        "evaluation.package_version": __version__,
        "hardware.gpu": gpu.get("gpu_name"),
        "hardware.vram_total_mb": gpu.get("vram_total_mb"),
        "hardware.expected_gpu": cfg.hardware.expected_gpu,
        "hardware.require_full_gpu_residency": cfg.hardware.require_full_gpu_residency,
        "runtime.llama_version": gpu.get("llama_version"),
        "runtime.local_studio_version": gpu.get("app_version"),
        "runtime.llama_bin": gpu.get("llama_bin"),
        "git.sha": git_sha(),
        "judge.provider": cfg.evaluation.semantic_judge,
        "cloud_credentials_configured": False,
    }


def run_evaluation(cfg: LabConfig, suite_name: str | None = None) -> dict[str, Any]:
    import mlflow

    suite_name = suite_name or cfg.evaluation.suite
    cfg.evaluation.suite = suite_name
    suite = load_suite(cfg.evaluation.dataset, suite_name)
    items = suite["items"]
    warn_cloud_judge(cfg, len(items))
    client = ControllerClient(cfg.controller_url, cfg.api_key)
    snapshot = client.snapshot()
    gpu = evaluate_gpu_fit(cfg, snapshot, client)
    if gpu["failed"] and cfg.hardware.require_full_gpu_residency:
        report = {
            "status": "FAILED",
            "reason": "full GPU residency requirement not met",
            "gpu_fit": gpu,
            "items": [],
        }
        return _log_failed(cfg, suite, gpu, snapshot, report)

    mlflow.set_tracking_uri(cfg.mlflow_tracking_uri)
    mlflow.set_experiment(EXPERIMENTS["performance"])
    results = []
    t0 = time.perf_counter()
    with mlflow.start_run(run_name=f"{cfg.model.name}-{suite_name}") as run:
        mlflow.set_tags(
            {
                "suite": suite_name,
                "dataset_version": suite.get("version") or DATASET_VERSION,
                "semantic_judge": cfg.evaluation.semantic_judge,
                "backend": cfg.model.backend,
                "quantization": cfg.model.quantization,
                "model": cfg.model.name,
            }
        )
        mlflow.log_params({k: v for k, v in flatten_params(cfg, gpu, suite).items() if v is not None})
        for item in items:
            payload = {
                "model": cfg.model.name,
                "messages": [{"role": "user", "content": item["prompt"]}],
                "temperature": cfg.generation.temperature,
                "top_p": cfg.generation.top_p,
                "max_tokens": int(item.get("max_tokens") or cfg.generation.max_tokens),
                "stream": True,
            }
            if cfg.generation.seed is not None:
                payload["seed"] = cfg.generation.seed
            _, gpus_now = client.get("/gpus")
            before = ((gpus_now or {}).get("gpus") or [{}])[0]
            completion = stream_chat(cfg.chat_url, cfg.api_key, payload, cfg.evaluation.timeout_s)
            _, gpus_after = client.get("/gpus")
            after = ((gpus_after or {}).get("gpus") or [{}])[0]
            scored = score_item(item, completion.get("text") or "", completion.get("error"))
            auto_metrics = metrics_from_result(completion)
            row = {
                "item": item,
                "output": completion.get("text") or "",
                "completion": completion,
                "score": scored,
                "metrics": auto_metrics,
                "gpu_before": before,
                "gpu_after": after,
            }
            results.append(row)
            prefix = f"case.{item['id']}."
            mlflow.log_metrics(
                {prefix + k: v for k, v in auto_metrics.items() if isinstance(v, (int, float))}
            )
            if scored.get("automatic_pass") is not None:
                mlflow.log_metrics({prefix + "automatic_pass": 1.0 if scored["automatic_pass"] else 0.0})
            mlflow.log_metrics(
                {
                    prefix + "vram_used_mb": float(after.get("memory_used_mb") or 0),
                    prefix + "gpu_util_pct": float(after.get("utilization_pct") or 0),
                }
            )

        auto_pass = [r for r in results if r["score"].get("automatic_pass") is not None]
        n_pass = sum(1 for r in auto_pass if r["score"]["automatic_pass"])
        completion_tokens = sum(r["metrics"].get("completion_tokens", 0) for r in results)
        prompt_tokens = sum(r["metrics"].get("prompt_tokens", 0) for r in results)
        errors = sum(1 for r in results if r["completion"].get("error"))
        timeouts = sum(1 for r in results if r["completion"].get("timeout"))
        gen_speeds = [r["metrics"]["generation_tokens_per_sec"] for r in results if "generation_tokens_per_sec" in r["metrics"]]
        prompt_speeds = [r["metrics"]["prompt_tokens_per_sec"] for r in results if "prompt_tokens_per_sec" in r["metrics"]]
        ttfts = [r["metrics"]["ttft_s"] for r in results if "ttft_s" in r["metrics"]]
        latencies = [r["metrics"]["latency_s"] for r in results]
        peak_vram = max((float((r["gpu_after"] or {}).get("memory_used_mb") or 0) for r in results), default=0.0)
        summary = {
            "n_samples": len(results),
            "n_deterministic": len(auto_pass),
            "n_deterministic_pass": n_pass,
            "deterministic_pass_rate": (n_pass / len(auto_pass)) if auto_pass else None,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
            "errors": errors,
            "timeouts": timeouts,
            "mean_latency_s": sum(latencies) / len(latencies) if latencies else None,
            "mean_ttft_s": sum(ttfts) / len(ttfts) if ttfts else None,
            "mean_prompt_tokens_per_sec": sum(prompt_speeds) / len(prompt_speeds) if prompt_speeds else None,
            "mean_generation_tokens_per_sec": sum(gen_speeds) / len(gen_speeds) if gen_speeds else None,
            "peak_vram_mb": peak_vram,
            "successful_tasks_per_generated_token": (n_pass / completion_tokens) if completion_tokens and auto_pass else None,
            "wall_s": time.perf_counter() - t0,
        }
        if summary["mean_generation_tokens_per_sec"] is not None:
            if summary["mean_generation_tokens_per_sec"] < cfg.hardware.min_gpu_generation_tps:
                gpu["reasons"] = list(gpu.get("reasons") or []) + [
                    f"generation {summary['mean_generation_tokens_per_sec']:.2f} tok/s below GPU floor {cfg.hardware.min_gpu_generation_tps}"
                ]
                if cfg.hardware.require_full_gpu_residency:
                    gpu["failed"] = True
                    gpu["full_gpu_residency"] = False
        mlflow.log_metrics(
            {
                f"auto.{k}": v
                for k, v in summary.items()
                if isinstance(v, (int, float)) and v is not None
            }
        )
        mlflow.log_metrics(
            {
                "hardware.vram_used_mb": float(gpu.get("vram_used_mb") or 0),
                "hardware.peak_vram_mb": peak_vram,
                "hardware.cpu_offloaded_layers": float(gpu.get("cpu_offloaded_layers") or 0),
                "hardware.full_gpu_residency": 1.0 if gpu.get("full_gpu_residency") else 0.0,
            }
        )
        payload = {
            "status": "FAILED" if gpu.get("failed") else "ok",
            "run_id": run.info.run_id,
            "experiment_id": run.info.experiment_id,
            "gpu_fit": gpu,
            "summary": summary,
            "config": flatten_params(cfg, gpu, suite),
            "items": [
                {
                    "test_id": r["item"]["id"],
                    "category": r["item"].get("category"),
                    "prompt": r["item"]["prompt"],
                    "reference": r["item"].get("reference"),
                    "output": r["output"],
                    "score": r["score"],
                    "metrics": r["metrics"],
                    "error": r["completion"].get("error"),
                }
                for r in results
            ],
        }
        from llm_lab_eval.report import write_reports
        from llm_lab_eval.genai import record_programmatic_genai

        artifacts = write_reports(payload)
        for artifact in artifacts:
            mlflow.log_artifact(str(artifact))
        genai_info = record_programmatic_genai(payload)
        mlflow.set_tag("mlflow_genai_evaluate", "used" if genai_info.get("used") else "skipped")
        mlflow.log_param("mlflow_genai_evaluate_reason", str(genai_info.get("reason") or "")[:250])
        if gpu.get("failed"):
            mlflow.set_tag("gpu_fit", "failed")
        else:
            mlflow.set_tag("gpu_fit", "ok" if gpu.get("full_gpu_residency") else "unknown")
        return payload


def _log_failed(cfg: LabConfig, suite: dict[str, Any], gpu: dict[str, Any], snapshot: dict[str, Any], report: dict[str, Any]) -> dict[str, Any]:
    import mlflow

    mlflow.set_tracking_uri(cfg.mlflow_tracking_uri)
    mlflow.set_experiment(EXPERIMENTS["performance"])
    with mlflow.start_run(run_name=f"{cfg.model.name}-{cfg.evaluation.suite}-FAILED") as run:
        mlflow.set_tags({"gpu_fit": "failed", "suite": cfg.evaluation.suite, "model": cfg.model.name})
        mlflow.log_params({k: v for k, v in flatten_params(cfg, gpu, suite).items() if v is not None})
        mlflow.log_metrics({"hardware.full_gpu_residency": 0.0})
        report["run_id"] = run.info.run_id
        report["experiment_id"] = run.info.experiment_id
        from llm_lab_eval.report import write_reports

        for artifact in write_reports(report):
            mlflow.log_artifact(str(artifact))
    return report
