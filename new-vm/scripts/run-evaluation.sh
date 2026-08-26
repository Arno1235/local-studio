#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
if [[ ! -x evaluation/.venv/bin/python ]]; then
  python3 -m venv --without-pip evaluation/.venv 2>/dev/null || python3 -m venv evaluation/.venv
  if [[ ! -x evaluation/.venv/bin/pip ]]; then
    curl -fsSL https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py
    evaluation/.venv/bin/python /tmp/get-pip.py
  fi
fi
evaluation/.venv/bin/pip install -q -e evaluation
export MLFLOW_TRACKING_URI="${MLFLOW_TRACKING_URI:-http://127.0.0.1:5000}"
exec evaluation/.venv/bin/python -m llm_lab_eval "$@"
