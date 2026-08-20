# New VM (frontend + MLflow)

This host runs two Docker services only:

1. `local-studio-frontend` — Next.js UI pointed at the OLD PC controller
2. `mlflow` — tracking server with SQLite + bind-mounted artifacts

It must not load GGUF weights or run llama.cpp.

```bash
cp .env.example .env
# set OLD_PC_LOCAL_STUDIO_API_KEY
bash new-vm/scripts/up.sh
bash new-vm/scripts/health.sh
```

URLs (LAN):

- Local Studio: `http://192.168.0.230:4783`
- MLflow: `http://192.168.0.230:5000`

See the repository README for the operating manual.
