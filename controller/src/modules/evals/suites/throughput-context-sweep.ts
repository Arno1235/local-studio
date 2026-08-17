import { Effect } from "effect";
import type { EvalCaseResult } from "@local-studio/contracts/evals";
import { mean, previewText, type EvalSuite, type EvalSuiteOutcome } from "./types";

const countingPrompt = (approxTokens: number): string => {
  const count = Math.max(32, Math.floor(approxTokens / 2));
  const numbers = Array.from({ length: count }, (_, index) => String(index)).join(" ");
  return `Read this sequence, then reply with exactly the word done.\n${numbers}`;
};

export const throughputContextSweep: EvalSuite = {
  id: "throughput.context-sweep",
  name: "Throughput sweep",
  description: "TTFT and decode tok/s at 1k context, plus a short decode run.",
  kind: "throughput",
  run: (context) =>
    Effect.gen(function* () {
      const promptTokens = Math.min(1000, Math.max(128, Math.floor(context.maxModelLen / 4)));
      yield* context.log(`Warmup chat (${promptTokens} prompt tokens target)`);
      yield* context.complete({
        messages: [{ role: "user", content: "Reply with the word ready." }],
        timeoutMs: 60_000,
      }).pipe(Effect.catch(() => Effect.succeed(null)));

      const prefill = yield* context.complete({
        messages: [{ role: "user", content: countingPrompt(promptTokens) }],
        stream: true,
        timeoutMs: 180_000,
      });
      const decode = yield* context.complete({
        messages: [
          {
            role: "user",
            content: "Count upward from 1 using digits separated by spaces. Stop after 80 numbers.",
          },
        ],
        stream: true,
        timeoutMs: 180_000,
      });

      const prefillTps =
        prefill.promptTokens > 0 && prefill.wallMs > 0
          ? (prefill.promptTokens / prefill.wallMs) * 1000
          : null;
      const decodeTps =
        decode.completionTokens > 0 && decode.wallMs > 0
          ? (decode.completionTokens / decode.wallMs) * 1000
          : 0;
      const ttft = mean(
        [prefill.ttftMs, decode.ttftMs].filter((value): value is number => value !== null),
      );
      const cases: EvalCaseResult[] = [
        {
          case_id: "prefill",
          passed: prefill.completionTokens > 0,
          score: prefillTps,
          metrics: {
            prompt_tokens: prefill.promptTokens,
            completion_tokens: prefill.completionTokens,
            ttft_ms: prefill.ttftMs,
            wall_ms: prefill.wallMs,
          },
          output_preview: previewText(prefill.content),
          error: null,
          duration_ms: Math.round(prefill.wallMs),
        },
        {
          case_id: "decode",
          passed: decode.completionTokens > 0,
          score: decodeTps,
          metrics: {
            prompt_tokens: decode.promptTokens,
            completion_tokens: decode.completionTokens,
            ttft_ms: decode.ttftMs,
            wall_ms: decode.wallMs,
          },
          output_preview: previewText(decode.content),
          error: null,
          duration_ms: Math.round(decode.wallMs),
        },
      ];
      const outcome: EvalSuiteOutcome = {
        score: decodeTps,
        displayScore: `${decodeTps.toFixed(1)} tok/s`,
        metrics: {
          decode_tps: decodeTps,
          prefill_tps: prefillTps,
          ttft_ms: ttft,
          prompt_tokens: promptTokens,
        },
        cases,
      };
      return outcome;
    }),
};
