#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=_docker.sh
source "$(dirname "${BASH_SOURCE[0]}")/_docker.sh" "$@"
cd "$ROOT"
service="${1:-}"
if [[ -z "$service" ]]; then
  docker compose --env-file .env logs --tail=200
else
  docker compose --env-file .env logs --tail=200 "$service"
fi
