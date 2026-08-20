from __future__ import annotations

import re
from typing import Any

from llm_lab_eval.config import OFFLOAD_RE, LabConfig
from llm_lab_eval.controller import ControllerClient


def _gpu(snapshot: dict[str, Any]) -> dict[str, Any]:
    body = (snapshot.get("gpus") or {}).get("body") or {}
    gpus = body.get("gpus") if isinstance(body, dict) else []
    return gpus[0] if gpus else {}


def _recipe(snapshot: dict[str, Any], name: str) -> dict[str, Any]:
    body = (snapshot.get("recipes") or {}).get("body") or []
    if isinstance(body, list):
        for recipe in body:
            if recipe.get("id") == name or recipe.get("served_model_name") == name:
                return recipe
    return {}


def parse_offload(text: str) -> tuple[int | None, int | None]:
    matches = OFFLOAD_RE.findall(text or "")
    if not matches:
        return None, None
    done, total = matches[-1]
    return int(done), int(total)


def evaluate_gpu_fit(cfg: LabConfig, snapshot: dict[str, Any], client: ControllerClient) -> dict[str, Any]:
    gpu = _gpu(snapshot)
    recipe = _recipe(snapshot, cfg.model.name)
    extra = recipe.get("extra_args") or {}
    ngl = ""
    if isinstance(extra, dict):
        ngl = str(extra.get("n-gpu-layers") or extra.get("ngl") or "").lower()
    elif isinstance(extra, list):
        joined = " ".join(str(part) for part in extra)
        found = re.search(r"n-gpu-layers[=\s]+(\S+)", joined, re.I)
        ngl = (found.group(1) if found else "").lower()
    status_body = (snapshot.get("status") or {}).get("body") or {}
    metrics = (snapshot.get("metrics") or {}).get("body") or {}
    compat = (snapshot.get("compat") or {}).get("body") or {}
    llamacpp = (snapshot.get("llamacpp") or {}).get("body") or {}
    diagnostics = (snapshot.get("diagnostics") or {}).get("body") or {}
    log_text = ""
    for session in (((snapshot.get("logs") or {}).get("body") or {}).get("sessions") or []):
        if isinstance(session, dict) and session.get("id"):
            log_text += "\n" + client.log_text(session["id"])
    extra_logs = snapshot.get("extra_logs") or {}
    if isinstance(extra_logs, dict):
        for payload in extra_logs.values():
            body = payload.get("body") if isinstance(payload, dict) else payload
            if isinstance(body, dict) and isinstance(body.get("content"), str):
                log_text += "\n" + body["content"]
            if isinstance(body, dict) and isinstance(body.get("logs"), list):
                log_text += "\n" + "\n".join(str(line) for line in body["logs"])
            elif isinstance(body, str):
                log_text += "\n" + body
    off_done, off_total = parse_offload(log_text)
    vram_used = float(gpu.get("memory_used_mb") or 0)
    vram_total = float(gpu.get("memory_total_mb") or 0)
    gpu_name = str(gpu.get("name") or "")
    backend = str((status_body.get("process") or {}).get("backend") or recipe.get("backend") or "")
    cuda = ((compat.get("platform") or {}).get("kind") == "cuda") if isinstance(compat, dict) else False
    requested_all = ngl in {"all", "99", "100", "-1"}
    layer_full = off_done is not None and off_total is not None and off_total > 0 and off_done == off_total
    cpu_offloaded = None
    if off_done is not None and off_total is not None:
        cpu_offloaded = max(off_total - off_done, 0)
    inferred = (
        requested_all
        and cuda
        and backend.lower() in {"llamacpp", "llama.cpp", "llama"}
        and cfg.hardware.expected_gpu.lower() in gpu_name.lower()
        and vram_used >= cfg.hardware.min_vram_used_mb
    )
    verified = bool(layer_full)
    failed = False
    reasons: list[str] = []
    if cfg.hardware.require_full_gpu_residency:
        if cpu_offloaded and cpu_offloaded > 0:
            failed = True
            reasons.append(f"CPU-offloaded layers: {cpu_offloaded}/{off_total}")
        if not gpu_name:
            failed = True
            reasons.append("controller reported no GPU")
        elif cfg.hardware.expected_gpu.lower() not in gpu_name.lower():
            failed = True
            reasons.append(f"expected {cfg.hardware.expected_gpu}, got {gpu_name}")
        if vram_used < cfg.hardware.min_vram_used_mb:
            failed = True
            reasons.append(f"VRAM used {vram_used} MiB < {cfg.hardware.min_vram_used_mb}")
        if not requested_all:
            failed = True
            reasons.append(f"recipe n-gpu-layers is {ngl or 'unset'}, expected all")
        if not inferred and not verified:
            failed = True
            reasons.append("could not confirm GPU residency from VRAM, recipe, or llama.cpp logs")
        if cpu_offloaded is None and not verified:
            reasons.append("llama.cpp layer-offload log was not available; residency inferred from telemetry")
    residency = (verified or inferred) and not (cpu_offloaded and cpu_offloaded > 0) and not failed
    return {
        "gpu_name": gpu_name,
        "vram_used_mb": vram_used,
        "vram_total_mb": vram_total,
        "gpu_utilization_pct": gpu.get("utilization_pct"),
        "gpu_temp_c": gpu.get("temp_c"),
        "gpu_power_w": gpu.get("power_draw"),
        "gpu_power_limit_w": gpu.get("power_limit"),
        "backend": backend,
        "cuda": cuda,
        "n_gpu_layers_arg": ngl or None,
        "offloaded_layers": off_done,
        "total_layers": off_total,
        "cpu_offloaded_layers": cpu_offloaded,
        "full_gpu_residency_verified": verified,
        "full_gpu_residency_inferred": inferred and not verified,
        "full_gpu_residency": residency,
        "failed": failed,
        "reasons": reasons,
        "llama_version": (compat.get("backends") or {}).get("llamacpp", {}).get("version")
        if isinstance(compat, dict)
        else llamacpp.get("version"),
        "llama_bin": (diagnostics.get("config") or {}).get("llama_bin") or llamacpp.get("binary_path"),
        "app_version": diagnostics.get("app_version"),
        "cpu_model": diagnostics.get("cpu_model"),
        "ram_total_bytes": diagnostics.get("memory_total"),
        "metrics": metrics if isinstance(metrics, dict) else {},
        "context_length": recipe.get("max_model_len") or cfg.generation.context_length,
        "model_path": recipe.get("model_path") or (status_body.get("process") or {}).get("model_path"),
    }
