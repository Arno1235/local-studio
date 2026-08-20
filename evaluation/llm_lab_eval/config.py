from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]
EVAL_ROOT = Path(__file__).resolve().parents[1]


def load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        os.environ.setdefault(key, value)


def expand(value: Any) -> Any:
    if isinstance(value, str):
        return os.path.expandvars(value)
    if isinstance(value, dict):
        return {k: expand(v) for k, v in value.items()}
    if isinstance(value, list):
        return [expand(v) for v in value]
    return value


@dataclass
class ModelConfig:
    name: str
    endpoint: str
    backend: str = "llamacpp"
    quantization: str = ""
    revision: str = ""


@dataclass
class GenerationConfig:
    temperature: float = 0.0
    top_p: float = 0.95
    max_tokens: int = 256
    context_length: int = 8192
    seed: int | None = 42


@dataclass
class EvaluationConfig:
    dataset: str = "v1"
    suite: str = "standard"
    semantic_judge: str = "cursor-manual"
    deterministic_metrics: bool = True
    timeout_s: float = 180.0


@dataclass
class HardwareConfig:
    expected_gpu: str = "NVIDIA GeForce GTX 1660 Ti"
    require_full_gpu_residency: bool = True
    min_vram_used_mb: float = 2000.0
    min_gpu_generation_tps: float = 12.0


@dataclass
class LabConfig:
    model: ModelConfig
    generation: GenerationConfig
    evaluation: EvaluationConfig
    hardware: HardwareConfig
    controller_url: str
    api_key: str
    mlflow_tracking_uri: str
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def chat_url(self) -> str:
        return self.model.endpoint.rstrip("/") + "/chat/completions"


def load_config(path: str | Path | None = None) -> LabConfig:
    load_dotenv(ROOT / ".env")
    cfg_path = Path(path) if path else EVAL_ROOT / "configs" / "gemma-4-e4b-it-q4km.yaml"
    raw = expand(yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {})
    controller = os.environ.get("OLD_PC_LOCAL_STUDIO_URL", "http://192.168.0.69:8080").rstrip("/")
    endpoint = raw.get("model", {}).get("endpoint") or f"{controller}/v1"
    model = ModelConfig(
        name=raw.get("model", {}).get("name") or os.environ.get("OLD_PC_MODEL_NAME", "gemma-4-e4b-it-q4km"),
        endpoint=str(endpoint).rstrip("/"),
        backend=raw.get("model", {}).get("backend", "llamacpp"),
        quantization=raw.get("model", {}).get("quantization")
        or os.environ.get("OLD_PC_MODEL_QUANTIZATION", "Q4_K_M"),
        revision=str(raw.get("model", {}).get("revision") or ""),
    )
    gen = raw.get("generation") or {}
    ev = raw.get("evaluation") or {}
    hw = raw.get("hardware") or {}
    return LabConfig(
        model=model,
        generation=GenerationConfig(
            temperature=float(gen.get("temperature", 0.0)),
            top_p=float(gen.get("top_p", 0.95)),
            max_tokens=int(gen.get("max_tokens", 256)),
            context_length=int(gen.get("context_length", 8192)),
            seed=None if gen.get("seed") in (None, "", "none") else int(gen.get("seed", 42)),
        ),
        evaluation=EvaluationConfig(
            dataset=str(ev.get("dataset", "v1")),
            suite=str(ev.get("suite", "standard")),
            semantic_judge=str(ev.get("semantic_judge", "cursor-manual")),
            deterministic_metrics=bool(ev.get("deterministic_metrics", True)),
            timeout_s=float(ev.get("timeout_s", 180)),
        ),
        hardware=HardwareConfig(
            expected_gpu=str(hw.get("expected_gpu", "NVIDIA GeForce GTX 1660 Ti")),
            require_full_gpu_residency=bool(hw.get("require_full_gpu_residency", True)),
            min_vram_used_mb=float(hw.get("min_vram_used_mb", 2000)),
            min_gpu_generation_tps=float(hw.get("min_gpu_generation_tps", 12)),
        ),
        controller_url=controller,
        api_key=os.environ.get("OLD_PC_LOCAL_STUDIO_API_KEY")
        or os.environ.get("LOCAL_STUDIO_API_KEY")
        or "",
        mlflow_tracking_uri=os.environ.get("MLFLOW_TRACKING_URI", "http://127.0.0.1:5000"),
        raw=raw,
    )


OFFLOAD_RE = re.compile(r"offloaded\s+(\d+)/(\d+)\s+layers to GPU", re.I)
