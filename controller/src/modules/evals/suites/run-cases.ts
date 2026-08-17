import { Effect } from "effect";
import type { EvalCaseResult } from "@local-studio/contracts/evals";
import { previewText, type EvalSuiteContext, type EvalSuiteOutcome } from "./types";

export const summarizeCases = (cases: EvalCaseResult[]): EvalSuiteOutcome => {
  const passed = cases.filter((entry) => entry.passed).length;
  return {
    score: cases.length === 0 ? 0 : passed / cases.length,
    displayScore: `${passed}/${cases.length}`,
    metrics: { passed, total: cases.length },
    cases,
  };
};

export const runTextCases = (
  context: EvalSuiteContext,
  specs: ReadonlyArray<{
    id: string;
    prompt: string;
    timeoutMs?: number;
    grade: (text: string) => boolean;
  }>,
): Effect.Effect<EvalSuiteOutcome> =>
  Effect.gen(function* () {
    const cases: EvalCaseResult[] = [];
    for (const spec of specs) {
      const started = performance.now();
      const result = yield* context
        .complete({
          messages: [{ role: "user", content: spec.prompt }],
          timeoutMs: spec.timeoutMs ?? 60_000,
        })
        .pipe(
          Effect.map((completion) => ({ text: completion.content, error: null as string | null })),
          Effect.catch((error) => Effect.succeed({ text: "", error: error.message })),
        );
      const passed = result.error === null && spec.grade(result.text);
      cases.push({
        case_id: spec.id,
        passed,
        score: passed ? 1 : 0,
        metrics: {},
        output_preview: previewText(result.text),
        error: result.error,
        duration_ms: Math.round(performance.now() - started),
      });
      yield* context.log(`${spec.id}: ${passed ? "pass" : "fail"}`);
    }
    return summarizeCases(cases);
  });
