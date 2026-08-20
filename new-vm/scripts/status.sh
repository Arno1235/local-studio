#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=_docker.sh
source "$(dirname "${BASH_SOURCE[0]}")/_docker.sh" "$@"
cd "$ROOT"
docker compose --env-file .env ps
echo
docker compose --env-file .env images
