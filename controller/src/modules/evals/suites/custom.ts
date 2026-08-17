import type { Effect } from "effect";
import type { EvalCustomSuite, EvalGrader } from "@local-studio/contracts/evals";
import { extractJson, type EvalSuite, type EvalSuiteOutcome } from "./types";
import { runTextCases } from "./run-cases";

const grade = (grader: EvalGrader, expected: string, output: string): boolean => {
  const text = output.trim();
  if (grader === "exact") return text === expected.trim();
  if (grader === "contains") return text.toLowerCase().includes(expected.trim().toLowerCase());
  if (grader === "regex") {
    try {
      return new RegExp(expected, "m").test(output);
    } catch {
      return false;
    }
  }
  const parsed = extractJson(output);
  if (parsed === null) return false;
  if (!expected.trim()) return true;
  try {
    return JSON.stringify(parsed) === JSON.stringify(JSON.parse(expected));
  } catch {
    return JSON.stringify(parsed).includes(expected.trim());
  }
};

export const customSuite = (definition: EvalCustomSuite): EvalSuite => ({
  id: definition.id,
  name: definition.name,
  description: definition.description || "Custom prompt eval",
  kind: "custom",
  run: (context): Effect.Effect<EvalSuiteOutcome> => {
    const specs =
      definition.cases.length > 0
        ? definition.cases.map((entry) => ({
            id: entry.id,
            prompt: entry.prompt,
            expected: entry.expected ?? definition.expected,
          }))
        : [{ id: "prompt", prompt: definition.prompt, expected: definition.expected }];
    return runTextCases(
      context,
      specs.map((spec) => ({
        id: spec.id,
        prompt: spec.prompt,
        timeoutMs: 90_000,
        grade: (text) => grade(definition.grader, spec.expected, text),
      })),
    );
  },
});
