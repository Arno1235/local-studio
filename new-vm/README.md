# New VM (frontend, MLflow, evaluation)

Runs on the newer PC. It must not store GGUF weights; those stay on the old PC.

Point the Local Studio frontend at the old-PC controller:

- `BACKEND_URL=http://192.168.0.69:8080`
- `LOCAL_STUDIO_API_KEY` (same key as the controller `.env.local`)

```bash
cp new-vm/.env.example new-vm/.env
docker compose -f new-vm/docker-compose.yml up -d
```

Production frontend in this repo binds loopback on the host by default (port `4783`). In Docker, publish only on the VM LAN, never the public internet.
