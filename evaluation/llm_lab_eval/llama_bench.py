from __future__ import annotations

import json
import os
import shlex
import time
from pathlib import Path
from typing import Any

from llm_lab_eval.config import EVAL_ROOT, LabConfig
from llm_lab_eval.controller import ControllerClient

IDLE_VRAM_MB = 1024.0
IDLE_WAIT_S = 120.0
BENCH_TIMEOUT_S = 1800.0


def redact(text: str, secret: str) -> str:
    if not secret:
        return text
    return text.replace(secret, "***")


def ssh_settings(password_file: str | None = None) -> dict[str, Any]:
    password = (os.environ.get("OLD_PC_SSH_PASSWORD") or "").strip()
    if password_file:
        password = Path(password_file).read_text(encoding="utf-8").rstrip("\n")
    return {
        "host": (os.environ.get("OLD_PC_SSH_HOST") or os.environ.get("OLD_PC_HOST") or "192.168.0.69").strip(),
        "user": (os.environ.get("OLD_PC_SSH_USER") or "anon").strip(),
        "password": password,
        "port": int(os.environ.get("OLD_PC_SSH_PORT") or "22"),
    }


def gpu_used_mb(client: ControllerClient) -> float | None:
    status, body = client.get("/gpus")
    if status != 200 or not isinstance(body, dict):
        return None
    gpus = body.get("gpus") or []
    if not gpus or not isinstance(gpus[0], dict):
        return None
    value = gpus[0].get("memory_used_mb")
    return float(value) if isinstance(value, (int, float)) else None


def find_recipe(client: ControllerClient, name: str) -> dict[str, Any]:
    status, body = client.get("/recipes")
    rows = body if isinstance(body, list) else []
    for recipe in rows:
        if not isinstance(recipe, dict):
            continue
        if recipe.get("id") == name or recipe.get("served_model_name") == name:
            return recipe
    return {}


def extract_json(text: str) -> Any:
    start_list = text.find("[")
    start_obj = text.find("{")
    starts = [index for index in (start_list, start_obj) if index >= 0]
    if not starts:
        return None
    return json.loads(text[min(starts) :])


def classify_row(row: dict[str, Any]) -> str | None:
    label = str(row.get("test") or "").lower().replace(" ", "")
    n_prompt = int(row.get("n_prompt") or 0)
    n_gen = int(row.get("n_gen") or 0)
    if label.startswith("pp") or (n_gen == 0 and n_prompt > 0):
        return f"pp{n_prompt or label.replace('pp', '')}"
    if label.startswith("tg") or n_gen > 0:
        return f"tg{n_gen or label.replace('tg', '')}"
    return None


def parse_bench_rows(raw: Any) -> dict[str, dict[str, float]]:
    rows = raw if isinstance(raw, list) else [raw] if isinstance(raw, dict) else []
    out: dict[str, dict[str, float]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = classify_row(row)
        if not name:
            continue
        avg = row.get("avg_ts")
        std = row.get("stddev_ts")
        if not isinstance(avg, (int, float)):
            continue
        out[name] = {
            "mean_tok_s": float(avg),
            "stdev": float(std) if isinstance(std, (int, float)) else 0.0,
            "n_prompt": float(row.get("n_prompt") or 0),
            "n_gen": float(row.get("n_gen") or 0),
        }
    return out


def ssh_exec(settings: dict[str, Any], command: str, timeout: float) -> tuple[int, str, str]:
    import paramiko

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            hostname=str(settings["host"]),
            port=int(settings["port"]),
            username=str(settings["user"]),
            password=str(settings["password"]),
            timeout=20,
            banner_timeout=20,
            auth_timeout=20,
            allow_agent=False,
            look_for_keys=False,
        )
        wrapped = f"bash -lc {shlex.quote(command)}"
        _stdin, stdout, stderr = client.exec_command(wrapped, timeout=timeout)
        out = stdout.read().decode("utf-8", "replace")
        err = stderr.read().decode("utf-8", "replace")
        code = stdout.channel.recv_exit_status()
        return code, out, err
    finally:
        client.close()


def remote_script(server_bin: str, gguf: str) -> str:
    server = shlex.quote(server_bin)
    model = shlex.quote(gguf)
    return f"""
set -euo pipefail
export CUDA_HOME="${{CUDA_HOME:-/usr/local/cuda}}"
export PATH="$CUDA_HOME/bin:$PATH"
export LD_LIBRARY_PATH="$CUDA_HOME/lib64:${{LD_LIBRARY_PATH:-}}"
SERVER={server}
GGUF={model}
BINDIR="$(dirname "$SERVER")"
BENCH="$BINDIR/llama-bench"
if [[ ! -x "$BENCH" ]]; then
  BUILD="$(cd "$BINDIR/.." && pwd)"
  cmake --build "$BUILD" --target llama-bench -j"$(nproc)"
fi
"$BENCH" -m "$GGUF" -ngl 99 -p 512,2048 -n 128 -r 3 -o json
"""


def render_markdown(payload: dict[str, Any]) -> str:
    lines = [
        "# llama-bench (OLD PC via SSH)",
        "",
        f"- Status: **{payload.get('status')}**",
        f"- Host: `{payload.get('ssh_host')}` user `{payload.get('ssh_user')}`",
        f"- Binary: `{payload.get('binary')}`",
        f"- GGUF: `{payload.get('gguf')}`",
        "",
        "| test | mean_tok_s | stdev | n_prompt | n_gen |",
        "| --- | --- | --- | --- | --- |",
    ]
    for name in ("pp512", "pp2048", "tg128"):
        row = (payload.get("tests") or {}).get(name) or {}
        lines.append(
            f"| {name} | {row.get('mean_tok_s')} | {row.get('stdev')} | "
            f"{row.get('n_prompt')} | {row.get('n_gen')} |"
        )
    extra = [key for key in (payload.get("tests") or {}) if key not in {"pp512", "pp2048", "tg128"}]
    for name in extra:
        row = payload["tests"][name]
        lines.append(
            f"| {name} | {row.get('mean_tok_s')} | {row.get('stdev')} | "
            f"{row.get('n_prompt')} | {row.get('n_gen')} |"
        )
    if payload.get("error"):
        lines += ["", f"- Error: {payload['error']}"]
    return "\n".join(lines) + "\n"


def write_artifacts(payload: dict[str, Any]) -> list[Path]:
    out_dir = EVAL_ROOT / "output"
    out_dir.mkdir(parents=True, exist_ok=True)
    slug = str(payload.get("model") or "model").replace("/", "-")
    json_path = out_dir / f"llama-bench-{slug}.json"
    md_path = out_dir / f"llama-bench-{slug}.md"
    safe = {key: value for key, value in payload.items() if key != "password"}
    json_path.write_text(json.dumps(safe, indent=2, default=str) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(payload), encoding="utf-8")
    return [json_path, md_path]


def log_mlflow(cfg: LabConfig, payload: dict[str, Any]) -> None:
    try:
        import mlflow
        from llm_lab_eval.runner import EXPERIMENTS

        mlflow.set_tracking_uri(cfg.mlflow_tracking_uri)
        mlflow.set_experiment(EXPERIMENTS["performance"])
        with mlflow.start_run(run_name=f"{cfg.model.name}-llama-bench") as run:
            mlflow.set_tags(
                {
                    "suite": "llama-bench",
                    "model": cfg.model.name,
                    "backend": cfg.model.backend,
                    "quantization": cfg.model.quantization,
                    "method": "llama-bench-ssh",
                }
            )
            mlflow.log_params(
                {
                    "model.name": cfg.model.name,
                    "ssh.host": payload.get("ssh_host"),
                    "ssh.user": payload.get("ssh_user"),
                    "llama_bench.binary": payload.get("binary") or "",
                }
            )
            for test_id, row in (payload.get("tests") or {}).items():
                for key in ("mean_tok_s", "stdev"):
                    value = row.get(key)
                    if isinstance(value, (int, float)):
                        mlflow.log_metrics({f"llama_bench.{test_id}.{key}": float(value)})
            payload["mlflow_run_id"] = run.info.run_id
            for artifact in write_artifacts(payload):
                mlflow.log_artifact(str(artifact))
    except Exception as exc:
        payload["mlflow_error"] = f"{type(exc).__name__}: {exc}"[:240]


def wait_idle(client: ControllerClient) -> dict[str, Any]:
    started = time.perf_counter()
    last = gpu_used_mb(client)
    while time.perf_counter() - started < IDLE_WAIT_S:
        used = gpu_used_mb(client)
        last = used if used is not None else last
        if used is not None and used <= IDLE_VRAM_MB:
            return {"idle": True, "vram_used_mb": used, "wait_s": time.perf_counter() - started}
        time.sleep(2)
    return {"idle": False, "vram_used_mb": last, "wait_s": time.perf_counter() - started}


def run_llama_bench(
    cfg: LabConfig,
    *,
    password_file: str | None = None,
    reload: bool = True,
) -> dict[str, Any]:
    settings = ssh_settings(password_file)
    client = ControllerClient(cfg.controller_url, cfg.api_key)
    recipe = find_recipe(client, cfg.model.name)
    runtime = recipe.get("runtime") if isinstance(recipe.get("runtime"), dict) else {}
    payload: dict[str, Any] = {
        "status": "ok",
        "method": "llama-bench-ssh",
        "model": cfg.model.name,
        "ssh_host": settings["host"],
        "ssh_user": settings["user"],
        "ssh_port": settings["port"],
        "recipe_id": recipe.get("id"),
        "gguf": recipe.get("model_path"),
        "binary": None,
        "tests": {},
    }
    if not settings["password"]:
        payload["status"] = "failed"
        payload["error"] = "OLD_PC_SSH_PASSWORD is empty; set it in .env or pass --ssh-password-file"
        write_artifacts(payload)
        return payload
    if not recipe.get("model_path"):
        payload["status"] = "failed"
        payload["error"] = f"no recipe/model_path for {cfg.model.name}"
        write_artifacts(payload)
        return payload
    server_bin = str(runtime.get("ref") or "")
    if not server_bin or server_bin == "llama-server":
        status, info = client.get("/runtime/llamacpp")
        if status == 200 and isinstance(info, dict):
            server_bin = str(info.get("binary_path") or info.get("path") or server_bin)
    if not server_bin:
        payload["status"] = "failed"
        payload["error"] = "could not resolve llama-server path"
        write_artifacts(payload)
        return payload
    payload["binary"] = str(Path(server_bin).with_name("llama-bench"))
    client.post("/evict")
    payload["idle"] = wait_idle(client)
    try:
        code, out, err = ssh_exec(settings, remote_script(server_bin, str(recipe["model_path"])), BENCH_TIMEOUT_S)
    except Exception as exc:
        payload["status"] = "failed"
        payload["error"] = redact(f"{type(exc).__name__}: {exc}", str(settings["password"]))
        write_artifacts(payload)
        if reload and recipe.get("id"):
            client.post(f"/launch/{recipe['id']}", timeout=600)
            client.get("/wait-ready?timeout=600", timeout=620)
        return payload
    payload["exit_code"] = code
    payload["stderr"] = redact(err[-4000:], str(settings["password"]))
    parsed = None
    try:
        parsed = extract_json(out)
    except json.JSONDecodeError:
        parsed = None
    payload["tests"] = parse_bench_rows(parsed) if parsed is not None else {}
    payload["stdout_tail"] = out[-4000:]
    if code != 0 or not payload["tests"]:
        payload["status"] = "failed"
        payload["error"] = payload.get("error") or redact(err.strip() or out.strip() or f"exit {code}", str(settings["password"]))
    if reload and recipe.get("id"):
        client.post(f"/launch/{recipe['id']}", timeout=600)
        ready_status, ready = client.get("/wait-ready?timeout=600", timeout=620)
        payload["reload"] = {"http": ready_status, "body": ready}
    log_mlflow(cfg, payload)
    write_artifacts(payload)
    return payload
