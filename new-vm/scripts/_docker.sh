if docker info >/dev/null 2>&1; then
  :
elif getent group docker 2>/dev/null | grep -qw "$(id -un)"; then
  quoted="$(printf '%q' "${BASH_SOURCE[1]}")"
  for arg in "$@"; do
    quoted="$quoted $(printf '%q' "$arg")"
  done
  exec sg docker -c "bash $quoted"
else
  echo "docker is not available; add $(id -un) to the docker group and re-login" >&2
  exit 1
fi
