# Old PC — Local Studio llama.cpp GPU backend

This machine is the inference node. The Local Studio **controller** and **llama.cpp** stay here. The web frontend belongs on the NEW VM, not here.

## Hardware (recorded)

| Item | Value |
| --- | --- |
| GPU | NVIDIA GeForce GTX 1660 Ti, 6144 MiB |
| LAN | `192.168.0.69:8080` (controller) |
| llama.cpp | `127.0.0.1:8081` (loopback only) |
| Models | stay on this disk; do not copy GGUF files to the NEW VM |

## Endpoints

| Surface | Address |
| --- | --- |
| Health | `http://192.168.0.69:8080/health` |
| Controller API | `http://192.168.0.69:8080` (API key) |
| OpenAI-compatible | `http://192.168.0.69:8080/v1` |

Bind the controller to the LAN NIC, not `0.0.0.0`, so Docker bridges on this box cannot reach it. Require `LOCAL_STUDIO_API_KEY`.

Copy `old-pc-backend/config/controller.env.example` to the checkout `.env.local` on the OLD PC only.

## First model

- Recipe: `gemma-4-e4b-it-q4km`
- File: `gemma-4-E4B-it-Q4_K_M.gguf` (Unsloth)
- Quant: Q4_K_M
- Recipe extra_args: `n-gpu-layers=all`
- Target: all llama.cpp layers GPU-resident, zero CPU-offloaded model layers

Weights are not stored in Git and must not be downloaded onto the NEW VM.

## Frontend

Keep the frontend and agent-runtime units disabled on this host. Chat and model management happen through the NEW VM UI talking to this controller.
