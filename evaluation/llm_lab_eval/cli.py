from __future__ import annotations

import argparse
import json

from llm_lab_eval.config import load_config
from llm_lab_eval.llama_bench import run_llama_bench
from llm_lab_eval.review import generate_cursor_review, import_review
from llm_lab_eval.runner import EXPERIMENTS, run_evaluation
from llm_lab_eval.served_bench import run_served_bench


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="llm-lab-eval")
    sub = parser.add_subparsers(dest="cmd", required=True)

    run_p = sub.add_parser("run", help="run automatic evaluation")
    run_p.add_argument("--config", default=None)
    run_p.add_argument("--suite", default=None)
    run_p.add_argument("--model", default=None)
    run_p.add_argument("--endpoint", default=None)

    gen_p = sub.add_parser("generate-cursor-review")
    gen_p.add_argument("--run-id", required=True)
    gen_p.add_argument("--suite", default=None)

    imp_p = sub.add_parser("import-cursor-review")
    imp_p.add_argument("--run-id", required=True)
    imp_p.add_argument("--file", required=True)

    hum_p = sub.add_parser("import-human-review")
    hum_p.add_argument("--run-id", required=True)
    hum_p.add_argument("--file", required=True)

    cmp_p = sub.add_parser("compare")
    cmp_p.add_argument("--run-a", required=True)
    cmp_p.add_argument("--run-b", required=True)

    bench_p = sub.add_parser("served-bench", help="speed bench via the served OpenAI endpoint")
    bench_p.add_argument("--config", default=None)
    bench_p.add_argument("--model", default=None)
    bench_p.add_argument("--endpoint", default=None)
    bench_p.add_argument("--repetitions", type=int, default=3)

    llama_p = sub.add_parser("llama-bench", help="native llama-bench on the OLD PC over SSH")
    llama_p.add_argument("--config", default=None)
    llama_p.add_argument("--model", default=None)
    llama_p.add_argument("--endpoint", default=None)
    llama_p.add_argument("--ssh-password-file", default=None)
    llama_p.add_argument("--no-reload", action="store_true")

    args = parser.parse_args(argv)
    if args.cmd == "run":
        cfg = load_config(args.config)
        if args.model:
            cfg.model.name = args.model
        if args.endpoint:
            cfg.model.endpoint = args.endpoint.rstrip("/")
        payload = run_evaluation(cfg, args.suite)
        print(json.dumps({"run_id": payload.get("run_id"), "status": payload.get("status")}, indent=2))
        if payload.get("status") == "FAILED":
            return 2
        return 0
    if args.cmd == "generate-cursor-review":
        generate_cursor_review(args.run_id, args.suite)
        return 0
    if args.cmd == "import-cursor-review":
        import_review(args.run_id, args.file, "cursor-manual")
        return 0
    if args.cmd == "import-human-review":
        import_review(args.run_id, args.file, "human")
        return 0
    if args.cmd == "compare":
        return compare_runs(args.run_a, args.run_b)
    if args.cmd == "served-bench":
        cfg = load_config(args.config)
        if args.model:
            cfg.model.name = args.model
        if args.endpoint:
            cfg.model.endpoint = args.endpoint.rstrip("/")
        payload = run_served_bench(cfg, max(1, args.repetitions))
        print(json.dumps(payload, indent=2, default=str))
        if payload.get("status") != "ok":
            return 2
        return 0
    if args.cmd == "llama-bench":
        cfg = load_config(args.config)
        if args.model:
            cfg.model.name = args.model
        if args.endpoint:
            cfg.model.endpoint = args.endpoint.rstrip("/")
        payload = run_llama_bench(
            cfg,
            password_file=args.ssh_password_file,
            reload=not args.no_reload,
        )
        print(json.dumps({k: v for k, v in payload.items() if k != "password"}, indent=2, default=str))
        if payload.get("status") != "ok":
            return 2
        return 0
    return 1


def compare_runs(run_a: str, run_b: str) -> int:
    import mlflow
    from llm_lab_eval.config import load_config
    from llm_lab_eval.report import write_reports

    cfg = load_config()
    mlflow.set_tracking_uri(cfg.mlflow_tracking_uri)
    mlflow.set_experiment(EXPERIMENTS["comparisons"])
    client = mlflow.tracking.MlflowClient()
    a = client.get_run(run_a)
    b = client.get_run(run_b)
    keys = sorted(set(a.data.metrics) | set(b.data.metrics))
    diff = {}
    for key in keys:
        va = a.data.metrics.get(key)
        vb = b.data.metrics.get(key)
        if va is None or vb is None:
            continue
        diff[key] = {"a": va, "b": vb, "b_minus_a": vb - va}
    payload = {
        "status": "ok",
        "run_a": run_a,
        "run_b": run_b,
        "params_a": a.data.params,
        "params_b": b.data.params,
        "metric_diff": diff,
    }
    with mlflow.start_run(run_name=f"compare-{run_a[:8]}-{run_b[:8]}"):
        mlflow.set_tags({"compare_a": run_a, "compare_b": run_b})
        mlflow.log_params(
            {
                "run_a": run_a,
                "run_b": run_b,
                "dataset_a": a.data.params.get("evaluation.dataset_version", ""),
                "dataset_b": b.data.params.get("evaluation.dataset_version", ""),
            }
        )
        artifacts = write_reports(payload)
        for artifact in artifacts:
            mlflow.log_artifact(str(artifact))
    print(json.dumps({"compared": [run_a, run_b], "metrics": len(diff)}, indent=2))
    return 0
