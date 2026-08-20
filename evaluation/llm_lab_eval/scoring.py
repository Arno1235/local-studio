from __future__ import annotations

import json
import re
from typing import Any


def normalize_text(value: str, mode: str | None) -> str:
    text = (value or "").strip()
    if mode in {"strip-lower", "lower"}:
        text = text.lower()
    if mode in {"strip-lower", "strip"}:
        text = " ".join(text.split())
    return text


def exact_match(output: str, reference: str, mode: str | None) -> bool:
    return normalize_text(output, mode) == normalize_text(reference, mode)


def contains_match(output: str, reference: str, mode: str | None) -> bool:
    return normalize_text(reference, mode) in normalize_text(output, mode)


def regex_match(output: str, pattern: str) -> bool:
    return re.search(pattern, output or "", re.I | re.S) is not None


def json_valid(output: str, schema: dict[str, Any] | None = None) -> tuple[bool, Any]:
    text = (output or "").strip()
    fence = re.search(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", text, re.S)
    if fence:
        text = fence.group(1)
    else:
        start_obj, start_arr = text.find("{"), text.find("[")
        starts = [i for i in (start_obj, start_arr) if i >= 0]
        if starts:
            text = text[min(starts) :]
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return False, None
    if not schema:
        return True, parsed
    required = schema.get("required") or []
    if schema.get("type") == "object" and not isinstance(parsed, dict):
        return False, parsed
    if isinstance(parsed, dict):
        for key in required:
            if key not in parsed:
                return False, parsed
    return True, parsed


def score_item(item: dict[str, Any], output: str, error: str | None) -> dict[str, Any]:
    scoring = item.get("scoring") or {}
    result = {
        "test_id": item["id"],
        "category": item.get("category"),
        "automatic_pass": None,
        "exact_match": None,
        "contains": None,
        "regex": None,
        "json_valid": None,
        "error": error,
    }
    if error:
        result["automatic_pass"] = False
        return result
    checks = []
    if scoring.get("exact_match"):
        ok = exact_match(output, str(item.get("reference") or ""), scoring.get("normalize"))
        result["exact_match"] = ok
        checks.append(ok)
    if scoring.get("contains"):
        ok = contains_match(output, str(scoring.get("contains") or item.get("reference") or ""), scoring.get("normalize"))
        result["contains"] = ok
        checks.append(ok)
    if scoring.get("regex"):
        ok = regex_match(output, str(scoring["regex"]))
        result["regex"] = ok
        checks.append(ok)
    if scoring.get("json_schema") is not None or scoring.get("json_valid"):
        ok, _ = json_valid(output, scoring.get("json_schema"))
        result["json_valid"] = ok
        checks.append(ok)
    if checks:
        result["automatic_pass"] = all(checks)
    return result
