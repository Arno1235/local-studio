from __future__ import annotations

import json
import ssl
import time
import urllib.error
import urllib.request
from typing import Any


def request_json(
    url: str,
    *,
    method: str = "GET",
    api_key: str = "",
    body: dict[str, Any] | None = None,
    timeout: float = 30.0,
) -> tuple[int, Any, dict[str, str]]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
        headers["X-API-Key"] = api_key
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as resp:
            raw = resp.read()
            payload: Any = None
            if raw:
                try:
                    payload = json.loads(raw.decode("utf-8"))
                except json.JSONDecodeError:
                    payload = raw.decode("utf-8", "replace")
            return resp.status, payload, {k.lower(): v for k, v in resp.headers.items()}
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        payload: Any = raw.decode("utf-8", "replace") if raw else ""
        try:
            payload = json.loads(payload) if payload else ""
        except json.JSONDecodeError:
            pass
        return exc.code, payload, {k.lower(): v for k, v in exc.headers.items()}


def stream_chat(
    url: str,
    api_key: str,
    payload: dict[str, Any],
    timeout: float,
) -> dict[str, Any]:
    body = dict(payload)
    body["stream"] = True
    data = json.dumps(body).encode("utf-8")
    headers = {
        "Accept": "text/event-stream",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        "X-API-Key": api_key,
    }
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    started = time.perf_counter()
    ttft = None
    text_parts: list[str] = []
    usage: dict[str, Any] = {}
    verbose: dict[str, Any] = {}
    model = payload.get("model")
    error = None
    chunks = 0
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            buf = b""
            while True:
                piece = resp.read(4096)
                eof = not piece
                if eof and buf.strip():
                    buf += b"\n"
                elif eof:
                    break
                else:
                    buf += piece
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    decoded = line.decode("utf-8", "replace").strip()
                    if not decoded.startswith("data:"):
                        continue
                    data_s = decoded[5:].strip()
                    if data_s == "[DONE]":
                        buf = b""
                        break
                    now = time.perf_counter()
                    if ttft is None:
                        ttft = now - started
                    chunks += 1
                    try:
                        obj = json.loads(data_s)
                    except json.JSONDecodeError:
                        continue
                    model = obj.get("model") or model
                    if obj.get("usage"):
                        usage = obj["usage"]
                    if obj.get("__verbose"):
                        verbose = {**verbose, **obj["__verbose"]}
                    choice = (obj.get("choices") or [{}])[0]
                    delta = choice.get("delta") or {}
                    message = choice.get("message") or {}
                    piece_text = delta.get("content")
                    if isinstance(piece_text, str) and piece_text:
                        text_parts.append(piece_text)
                    if isinstance(message.get("content"), str) and message["content"]:
                        verbose["final_message_content"] = message["content"]
                    reason_piece = delta.get("reasoning_content") or delta.get("reasoning")
                    if reason_piece:
                        verbose["reasoning_chunks"] = int(verbose.get("reasoning_chunks") or 0) + 1
                if eof:
                    break
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
    latency = time.perf_counter() - started
    timings = (verbose or {}).get("timings") or {}
    text = "".join(text_parts).strip() or str((verbose or {}).get("final_message_content") or "").strip()
    return {
        "text": text,
        "reasoning_chunks": int((verbose or {}).get("reasoning_chunks") or 0),
        "usage": usage,
        "verbose": verbose,
        "timings": timings,
        "ttft_s": ttft,
        "latency_s": latency,
        "chunks": chunks,
        "model": model,
        "error": error,
        "timeout": bool(error and "timeout" in error.lower()),
    }
