from __future__ import annotations

from typing import Any

from llm_lab_eval.http import request_json


class ControllerClient:
    def __init__(self, base_url: str, api_key: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    def get(self, path: str, timeout: float = 20.0) -> tuple[int, Any]:
        status, payload, _ = request_json(
            f"{self.base_url}{path}",
            api_key=self.api_key,
            timeout=timeout,
        )
        return status, payload

    def snapshot(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for path, key in [
            ("/health", "health"),
            ("/status", "status"),
            ("/gpus", "gpus"),
            ("/recipes", "recipes"),
            ("/compat", "compat"),
            ("/studio/diagnostics", "diagnostics"),
            ("/compute/devices", "compute_devices"),
            ("/compute/instances", "compute_instances"),
            ("/runtime/llamacpp", "llamacpp"),
            ("/v1/models", "models"),
            ("/v1/metrics/vllm", "metrics"),
            ("/logs", "logs"),
        ]:
            status, payload = self.get(path)
            out[key] = {"status": status, "body": payload}
        extra_ids = []
        recipes_body = out.get("recipes", {}).get("body") or []
        if isinstance(recipes_body, list):
            extra_ids.extend(
                str(recipe.get("id"))
                for recipe in recipes_body
                if isinstance(recipe, dict) and recipe.get("id")
            )
        instances_body = out.get("compute_instances", {}).get("body") or {}
        rows = instances_body.get("instances") if isinstance(instances_body, dict) else instances_body
        if isinstance(rows, list):
            extra_ids.extend(
                str(row.get("name") or row.get("id") or "")
                for row in rows
                if isinstance(row, dict)
            )
        extra_ids.extend(["llm", "llamacpp", "llama.cpp"])
        seen = {
            session.get("id")
            for session in (((out.get("logs") or {}).get("body") or {}).get("sessions") or [])
            if isinstance(session, dict)
        }
        extra_logs = {}
        for session_id in extra_ids:
            if not session_id or session_id in seen:
                continue
            status, payload = self.get(f"/logs/{session_id}?limit=4000", timeout=30)
            extra_logs[session_id] = {"status": status, "body": payload}
        if extra_logs:
            out["extra_logs"] = extra_logs
        return out

    def log_text(self, session_id: str, limit: int = 4000) -> str:
        status, payload = self.get(f"/logs/{session_id}?limit={limit}", timeout=30)
        if status != 200:
            return ""
        if isinstance(payload, str):
            return payload
        if isinstance(payload, dict):
            if isinstance(payload.get("content"), str):
                return payload["content"]
            logs = payload.get("logs")
            if isinstance(logs, list) and logs:
                return "\n".join(str(line) for line in logs)
            lines = payload.get("lines") or payload.get("entries") or []
            parts = []
            for line in lines:
                if isinstance(line, str):
                    parts.append(line)
                elif isinstance(line, dict):
                    parts.append(str(line.get("line") or line.get("message") or line))
            return "\n".join(parts)
        if isinstance(payload, list):
            return "\n".join(str(item) for item in payload)
        return str(payload)
