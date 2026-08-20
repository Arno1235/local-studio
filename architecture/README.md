# Lab architecture

```
NEW PC / Docker VM
  Local Studio frontend
  MLflow
  evaluation tooling
        │  LAN HTTP  (API key)
        ▼
OLD PC 192.168.0.69
  Local Studio controller :8080
        │  loopback
        ▼
  llama.cpp llama-server :8081
        │
        ▼
  NVIDIA GeForce GTX 1660 Ti (6 GB)
```

The old PC is a headless inference appliance: controller + llama.cpp + model weights. The frontend is disabled there.

Details: `old-pc-backend/README.md` and `new-vm/README.md`.
