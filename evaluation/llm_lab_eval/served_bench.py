from __future__ import annotations

import json
import statistics
import time
from pathlib import Path
from typing import Any

from llm_lab_eval.config import EVAL_ROOT, LabConfig
from llm_lab_eval.http import request_json, stream_chat
from llm_lab_eval.runner import metrics_from_result

PAD_UNIT = "lorem ipsum dolor sit amet consectetur adipiscing elit. "
TG_PROMPT = (
    "Continue this sequence of integers, one number per line, until you reach the token limit:\n"
    "1\n2\n3\n4\n5\n"
)
TESTS = (
    {"id": "pp512", "kind": "prefill", "prompt_tokens": 512, "max_tokens": 1},
    {"id": "pp2048", "kind": "prefill", "prompt_tokens": 2048, "max_tokens": 1},
    {"id": "tg128", "kind": "decode", "prompt_tokens": 0, "max_tokens": 128},
)


def count_tokens(cfg: LabConfig, text: str) -> int | None:
    status, payload, _ = request_json(
        f"{cfg.controller_url}/v1/count-tokens",
        method="POST",
        api_key=cfg.api_key,
        body={"model": cfg.model.name, "text": text},
        timeout=30.0,
    )
    if status != 200 or not isinstance(payload, dict):
        return None
    value = payload.get("num_tokens")
    if isinstance(value, (int, float)) and value > 0:
        return int(value)
    return None


def build_prompt(cfg: LabConfig, target_tokens: int) -> str:
    if target_tokens <= 0:
        return TG_PROMPT
    guess = max(len(PAD_UNIT), target_tokens * 5)
    text = PAD_UNIT * (guess // len(PAD_UNIT) + 1)
    counted = count_tokens(cfg, text)
    if counted is None:
        return text[: max(len(PAD_UNIT), target_tokens * 4)]
    for _ in range(8):
        if abs(counted - target_tokens) <= max(8, int(target_tokens * 0.04)):
            break
        if counted < 1:
            break
        next_len = max(len(PAD_UNIT), int(len(text) * (target_tokens / counted)))
        text = (PAD_UNIT * (next_len // len(PAD_UNIT) + 1))[:next_len]
        counted = count_tokens(cfg, text) or counted
    return text


def tok_s_for(kind: str, completion: dict[str, Any], metrics: dict[str, float]) -> float | None:
    timings = completion.get("timings") or {}
    if kind == "prefill":
        value = timings.get("prompt_per_second")
        if value is not None:
            return float(value)
        return metrics.get("prompt_tokens_per_sec")
    value = timings.get("predicted_per_second")
    if value is not None:
        return float(value)
    return metrics.get("generation_tokens_per_sec")


def run_once(
    cfg: LabConfig,
    *,
    prompt: str,
    max_tokens: int,
    timeout_s: float,
) -> dict[str, Any]:
    payload = {
        "model": cfg.model.name,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
        "top_p": cfg.generation.top_p,
        "max_tokens": max_tokens,
        "stream": True,
    }
    if cfg.generation.seed is not None:
        payload["seed"] = cfg.generation.seed
    completion = stream_chat(cfg.chat_url, cfg.api_key, payload, timeout_s)
    metrics = metrics_from_result(completion)
    return {"completion": completion, "metrics": metrics}


def summarize(values: list[float]) -> dict[str, float]:
    if not values:
        return {"mean": 0.0, "stdev": 0.0, "n": 0.0}
    return {
        "mean": float(statistics.mean(values)),
        "stdev": float(statistics.stdev(values)) if len(values) > 1 else 0.0,
        "n": float(len(values)),
    }


def render_markdown(payload: dict[str, Any]) -> str:
    lines = [
        "# Served-path speed bench",
        "",
        f"- Status: **{payload.get('status')}**",
        f"- Method: `{payload.get('method')}` (not the llama-bench binary)",
        f"- Model: `{payload.get('model')}`",
        f"- Repetitions: {payload.get('repetitions')}",
        f"- Endpoint: `{payload.get('endpoint')}`",
        "",
        "| test | mean_tok_s | stdev | prompt_tokens | completion_tokens |",
        "| --- | --- | --- | --- | --- |",
    ]
    for test_id, row in (payload.get("tests") or {}).items():
        lines.append(
            f"| {test_id} | {row.get('mean_tok_s')} | {row.get('stdev')} | "
            f"{row.get('prompt_tokens_mean')} | {row.get('completion_tokens_mean')} |"
        )
    if payload.get("error"):
        lines += ["", f"- Error: {payload['error']}"]
    return "\n".join(lines) + "\n"


def write_artifacts(payload: dict[str, Any]) -> list[Path]:
    out_dir = EVAL_ROOT / "output"
    out_dir.mkdir(parents=True, exist_ok=True)
    slug = str(payload.get("model") or "model").replace("/", "-")
    json_path = out_dir / f"served-bench-{slug}.json"
    md_path = out_dir / f"served-bench-{slug}.md"
    json_path.write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(payload), encoding="utf-8")
    return [json_path, md_path]


def log_mlflow(cfg: LabConfig, payload: dict[str, Any]) -> None:
    try:
        import mlflow
        from llm_lab_eval.runner import EXPERIMENTS

        mlflow.set_tracking_uri(cfg.mlflow_tracking_uri)
        mlflow.set_experiment(EXPERIMENTS["performance"])
        with mlflow.start_run(run_name=f"{cfg.model.name}-served-bench") as run:
            mlflow.set_tags(
                {
                    "suite": "served-bench",
                    "model": cfg.model.name,
                    "backend": cfg.model.backend,
                    "quantization": cfg.model.quantization,
                    "method": "served-path",
                }
            )
            mlflow.log_params(
                {
                    "model.name": cfg.model.name,
                    "model.endpoint": cfg.model.endpoint,
                    "served_bench.repetitions": payload.get("repetitions"),
                    "served_bench.method": "served-path",
                }
            )
            for test_id, row in (payload.get("tests") or {}).items():
                for key in ("mean_tok_s", "stdev", "prompt_tokens_mean", "completion_tokens_mean"):
                    value = row.get(key)
                    if isinstance(value, (int, float)):
                        mlflow.log_metrics({f"served.{test_id}.{key}": float(value)})
            payload["mlflow_run_id"] = run.info.run_id
            for artifact in write_artifacts(payload):
                mlflow.log_artifact(str(artifact))
    except Exception as exc:
        payload["mlflow_error"] = f"{type(exc).__name__}: {exc}"[:240]


def run_served_bench(cfg: LabConfig, repetitions: int = 3) -> dict[str, Any]:
    timeout_s = max(cfg.evaluation.timeout_s, 300.0)
    payload: dict[str, Any] = {
        "status": "ok",
        "method": "served-path-openai-chat",
        "not": "llama-bench-binary",
        "model": cfg.model.name,
        "endpoint": cfg.model.endpoint,
        "backend": cfg.model.backend,
        "quantization": cfg.model.quantization,
        "repetitions": repetitions,
        "warmup": True,
        "tests": {},
        "raw": [],
    }
    warmup = run_once(cfg, prompt="Reply with exactly: pong", max_tokens=16, timeout_s=timeout_s)
    payload["warmup_error"] = warmup["completion"].get("error")
    if warmup["completion"].get("error"):
        payload["status"] = "failed"
        payload["error"] = warmup["completion"]["error"]
        write_artifacts(payload)
        return payload

    prompts = {
        "pp512": build_prompt(cfg, 512),
        "pp2048": build_prompt(cfg, 2048),
        "tg128": TG_PROMPT,
    }
    for spec in TESTS:
        speeds: list[float] = []
        prompt_tokens: list[float] = []
        completion_tokens: list[float] = []
        rows: list[dict[str, Any]] = []
        for index in range(repetitions):
            started = time.perf_counter()
            result = run_once(
                cfg,
                prompt=prompts[spec["id"]],
                max_tokens=int(spec["max_tokens"]),
                timeout_s=timeout_s,
            )
            completion = result["completion"]
            metrics = result["metrics"]
            speed = tok_s_for(str(spec["kind"]), completion, metrics)
            row = {
                "rep": index + 1,
                "tok_s": speed,
                "prompt_tokens": metrics.get("prompt_tokens"),
                "completion_tokens": metrics.get("completion_tokens"),
                "ttft_s": metrics.get("ttft_s"),
                "latency_s": metrics.get("latency_s"),
                "wall_s": time.perf_counter() - started,
                "error": completion.get("error"),
            }
            rows.append(row)
            payload["raw"].append({"test": spec["id"], **row})
            if completion.get("error") or speed is None:
                payload["status"] = "failed"
                payload["error"] = completion.get("error") or f"{spec['id']} missing tok/s"
                continue
            speeds.append(float(speed))
            prompt_tokens.append(float(metrics.get("prompt_tokens") or 0))
            completion_tokens.append(float(metrics.get("completion_tokens") or 0))
        stats = summarize(speeds)
        payload["tests"][spec["id"]] = {
            "mean_tok_s": stats["mean"] if speeds else None,
            "stdev": stats["stdev"] if speeds else None,
            "prompt_tokens_mean": summarize(prompt_tokens)["mean"] if prompt_tokens else None,
            "completion_tokens_mean": summarize(completion_tokens)["mean"] if completion_tokens else None,
            "reps": rows,
        }
    log_mlflow(cfg, payload)
    write_artifacts(payload)
    return payload
