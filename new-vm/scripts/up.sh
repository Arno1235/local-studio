#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=_docker.sh
source "$(dirname "${BASH_SOURCE[0]}")/_docker.sh" "$@"
cd "$ROOT"
if [[ ! -f .env ]]; then
  echo "missing .env — copy .env.example to .env and set OLD_PC_LOCAL_STUDIO_API_KEY" >&2
  exit 1
fi
docker compose --env-file .env up -d --build "$@"
docker compose --env-file .env ps
