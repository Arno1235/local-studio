from __future__ import annotations

from typing import Any


def record_programmatic_genai(payload: dict[str, Any]) -> dict[str, Any]:
    items = payload.get("items") or []
    data = [
        {
            "inputs": {"prompt": item.get("prompt") or "", "test_id": item.get("test_id")},
            "outputs": item.get("output") or "",
            "expectations": {
                "reference": item.get("reference"),
                "automatic_pass": (item.get("score") or {}).get("automatic_pass"),
            },
        }
        for item in items
    ]
    try:
        import mlflow.genai as genai
        from mlflow.genai.scorers import scorer
    except Exception as exc:
        return {"used": False, "reason": f"{type(exc).__name__}: {exc}"}

    @scorer(name="deterministic_pass")
    def deterministic_pass(outputs, expectations):  # noqa: ARG001
        value = (expectations or {}).get("automatic_pass")
        if value is None:
            return 0.0
        return 1.0 if value else 0.0

    try:
        genai.evaluate(data=data, scorers=[deterministic_pass])
        return {"used": True, "reason": "mlflow.genai.evaluate programmatic scorer"}
    except Exception as exc:
        return {"used": False, "reason": f"{type(exc).__name__}: {exc}"}
