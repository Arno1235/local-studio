# Old PC — Local Studio llama.cpp GPU backend

This machine is the inference node. The Local Studio **controller** and **llama.cpp** stay here. The web frontend must **not** run here; it belongs on the new PC Docker VM.

## Hardware

| Item | Value |
| --- | --- |
| Role | GPU / inference appliance |
| CPU | Intel Core i7 960 (Nehalem, 8 threads, 3.2 GHz) |
| RAM | 6 GB |
| System disk | WDC WD5000AACS 466 GB HDD (`/dev/sda3` → `/`) |
| Model storage | `/home/anon/.local/share/local-studio/models` on `/` (no SSD; other disks are unmounted NTFS) |
| GPU | NVIDIA GeForce GTX 1660 Ti |
| VRAM | 6144 MiB |
| Compute capability | 7.5 (Turing) |
| NVIDIA driver | 560.35.03 |
| CUDA toolkit | 12.6.85 |
| OS | Ubuntu 24.04.1 LTS (`Linux anon 6.8.0-137-generic`) |
| LAN address | `192.168.0.69/24` on `enp7s0` |

## Software

| Item | Value |
| --- | --- |
| Checkout | `/home/anon/Documents/local-studio-fork` |
| Local Studio | `package.json` 2.1.0, git describe around `v2.9.10` (record `git rev-parse HEAD` after pull) |
| llama.cpp | managed source build under the controller data dir, `CMAKE_CUDA_ARCHITECTURES=75` |
| llama-server | `$LOCAL_STUDIO_LLAMA_BIN` |
| Data dir | `/home/anon/.local/share/local-studio/data` |
| Model dir | `/home/anon/.local/share/local-studio/models` |

Do not reinstall Local Studio. Point the existing systemd user unit at this checkout.

## Endpoints

| Surface | Address | Notes |
| --- | --- | --- |
| Controller API | `http://192.168.0.69:8080` | LAN bind, API key required |
| Health | `http://192.168.0.69:8080/health` | public, no key |
| OpenAI-compatible API | `http://192.168.0.69:8080/v1` | proxied by the controller |
| Chat completions | `POST http://192.168.0.69:8080/v1/chat/completions` | `Authorization: Bearer $LOCAL_STUDIO_API_KEY` |
| llama.cpp process | `127.0.0.1:8081` | loopback only; do not publish |

Bind host is `LOCAL_STUDIO_HOST=192.168.0.69` (LAN NIC), not `0.0.0.0`, so Docker bridges on this box cannot reach the API.

## Secrets (never commit)

| Variable | Purpose |
| --- | --- |
| `LOCAL_STUDIO_API_KEY` | Controller and `/v1` authentication |
| `HF_TOKEN` / `LOCAL_STUDIO_HF_TOKEN` | Optional Hugging Face downloads |

Live values live in the gitignored root `.env.local`. Copy `config/controller.env.example`.

## Start / stop

```bash
systemctl --user start local-studio-controller.service
systemctl --user stop local-studio-controller.service
systemctl --user status local-studio-controller.service
journalctl --user -u local-studio-controller.service -f
tail -f ~/.local/share/local-studio/controller.log
```

Linger is enabled (`loginctl enable-linger $USER`) so the unit starts at boot. The unit file is `config/local-studio-controller.service`.

The frontend and agent-runtime user units are **disabled**. `~/.config/autostart/local-studio-web.desktop` is hidden. `~/.local/bin/local-studio-stack` starts the controller only.

## Connectivity

```bash
curl -fsS http://192.168.0.69:8080/health
curl -fsS -H "Authorization: Bearer $LOCAL_STUDIO_API_KEY" http://192.168.0.69:8080/v1/models
bash old-pc-backend/scripts/health-check.sh
```

From another LAN host, use the same URLs. There is no public-internet listener.

## Benchmark

```bash
bash old-pc-backend/scripts/benchmark.sh
FIND_MAX_CTX=1 bash old-pc-backend/scripts/benchmark.sh
```

Reports write to `evaluation/reports/` (gitignored except `.gitkeep`). First model: Unsloth `gemma-4-E4B-it-Q4_K_M.gguf`.

## GPU offload diagnosis

1. Confirm `nvidia-smi` lists the 1660 Ti with free VRAM.
2. Confirm `$LOCAL_STUDIO_LLAMA_BIN --version` and CUDA in the binary (`ggml-cuda` / `--n-gpu-layers`).
3. Recipe must set `"backend": "llamacpp"` and `"extra_args": { "n-gpu-layers": "all" }`.
4. After launch, read `$LOCAL_STUDIO_DATA_DIR/instances/logs/llm.log` for `offloaded N/N layers to GPU` and `using device CUDA`.
5. `nvidia-smi` must show `llama-server` using MiB on GPU 0. If layers are `0/N` or only CPU buffers grow, VRAM is exhausted — lower `max_model_len` (try 2048) rather than CPU offload.
6. Do not switch this card to vLLM or SGLang.

## Firewall

Passwordless `sudo` is not available on this host, so rules are not applied automatically. On a trusted `192.168.0.0/24` LAN:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 192.168.0.0/24 to any port 8080 proto tcp
sudo ufw deny 8081
sudo ufw enable
```

Do not port-forward 8080/8081 on the router. Do not enable Tailscale Funnel.

## Model files

Weights stay on the old PC. The first benchmark file:

- Path: `/home/anon/.local/share/local-studio/models/unsloth/gemma-4-E4B-it-GGUF/gemma-4-E4B-it-Q4_K_M.gguf`
- Source: `https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF`
- Quant: Q4_K_M
- Size: 4977171584 bytes (matches Hugging Face `X-Linked-Size`)
- SHA256: `85a896a047553e842f25297ee5b031d64ff30147d9c4af17b1e4b394cd1fab87` (matches Hugging Face `X-Linked-ETag`)
- llama.cpp: `0.1.2-dev` commit `07822bd`, CUDA sm_75, `llama-server --list-devices` shows the GTX 1660 Ti
- Full GPU layer offload at context 2048 and 8192: `offloaded 43/43 layers to GPU`. Context 32768 allocated layers on GPU but the 6 GB host RAM was exhausted (systemd-oomd), so **8192 is the largest stable full-GPU context tested**.
- `token_embd.weight` / PLE tables stay in host RAM (~2.2 GiB); that is not layer offload.

To (re)download through the controller after it is healthy:

```bash
curl -fsS -H "Authorization: Bearer $LOCAL_STUDIO_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model_id":"unsloth/gemma-4-E4B-it-GGUF","allow_patterns":["gemma-4-E4B-it-Q4_K_M.gguf"]}' \
  http://192.168.0.69:8080/studio/downloads
```
