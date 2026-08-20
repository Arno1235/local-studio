#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ $# -eq 0 || "${1:-}" == --* ]]; then
  exec bash "$ROOT/new-vm/scripts/run-evaluation.sh" run "$@"
fi
exec bash "$ROOT/new-vm/scripts/run-evaluation.sh" "$@"
