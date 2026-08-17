import { arch, cpus, platform, totalmem } from "node:os";
import { Effect } from "effect";
import type { EvalHardware } from "@local-studio/contracts/evals";
import { getGpuInfo } from "../system/platform/gpu";

interface KnownHardware {
  pattern: RegExp;
  id: string;
  memoryGb: number;
}

const KNOWN: readonly KnownHardware[] = [
  { pattern: /\bGB10\b|DGX Spark/i, id: "gb10_121", memoryGb: 121 },
  { pattern: /\bGB300\b/i, id: "gb300", memoryGb: 288 },
  { pattern: /RTX PRO 6000/i, id: "rtxpro6000_96", memoryGb: 96 },
  { pattern: /RTX 6000 Ada|6000 ADA/i, id: "rtx6000ada_48", memoryGb: 48 },
  { pattern: /RTX 5090/i, id: "rtx5090_32", memoryGb: 32 },
  { pattern: /RTX 4090/i, id: "rtx4090_24", memoryGb: 24 },
];

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);

export const detectEvalHardware = (): Effect.Effect<EvalHardware> =>
  getGpuInfo().pipe(
    Effect.map((gpus) => {
      const ramGb = Math.round(totalmem() / 1024 ** 3);
      if (gpus.length === 0 && platform() === "darwin" && arch() === "arm64") {
        const cpu = cpus()[0]?.model ?? "Apple Silicon";
        return {
          id: `apple_${ramGb}`,
          label: `${cpu} ${ramGb} GB`,
          gpu_name: cpu,
          gpu_count: 1,
          memory_gb: ramGb,
        };
      }
      const primary = gpus[0];
      const name = primary?.name ?? "cpu";
      const count = gpus.length;
      const memoryGb = Math.round(
        gpus.reduce((sum, gpu) => sum + gpu.memory_total_mb, 0) / 1024,
      );
      const known = KNOWN.find((entry) => entry.pattern.test(name));
      if (known) {
        const id =
          known.id === "gb300" && count >= 2
            ? "gb300x2"
            : known.id === "rtxpro6000_96" && count >= 2
              ? `rtxpro6000_${known.memoryGb}x${count}`
              : known.id;
        return {
          id,
          label: count > 1 ? `${name} ×${count}` : name,
          gpu_name: name,
          gpu_count: count,
          memory_gb: memoryGb || known.memoryGb,
        };
      }
      return {
        id: `${slug(name) || "gpu"}_${memoryGb || ramGb}${count > 1 ? `x${count}` : ""}`,
        label: count > 1 ? `${name} ×${count}` : name,
        gpu_name: name,
        gpu_count: Math.max(count, 1),
        memory_gb: memoryGb || ramGb,
      };
    }),
  );
