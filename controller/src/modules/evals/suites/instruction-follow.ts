import { extractJson, type EvalSuite } from "./types";
import { runTextCases } from "./run-cases";

const CASES: Array<{ id: string; prompt: string; check: (text: string) => boolean }> = [
  {
    id: "exact-ok",
    prompt: "Reply with exactly the two letters OK and nothing else.",
    check: (text) => text.trim() === "OK",
  },
  {
    id: "multiply",
    prompt: "What is 17 multiplied by 19? Reply with only the integer.",
    check: (text) => text.trim().replace(/[, ]/g, "") === "323",
  },
  {
    id: "json-object",
    prompt: 'Reply with only this JSON object: {"a":1,"b":2}',
    check: (text): boolean => {
      const parsed = extractJson(text);
      return Boolean(
        parsed &&
          typeof parsed === "object" &&
          !Array.isArray(parsed) &&
          (parsed as { a?: unknown; b?: unknown }).a === 1 &&
          (parsed as { a?: unknown; b?: unknown }).b === 2,
      );
    },
  },
  {
    id: "reverse",
    prompt: "Spell HELLO backwards using only uppercase letters. Reply with those letters only.",
    check: (text) => text.trim().replace(/[^A-Za-z]/g, "").toUpperCase() === "OLLEH",
  },
  {
    id: "csv",
    prompt: "Reply with exactly these three lowercase color names, comma-separated: red,green,blue",
    check: (text) =>
      text
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "") === "red,green,blue",
  },
  {
    id: "yes-no",
    prompt: "Is 91 a prime number? Reply with only yes or no.",
    check: (text) => /^no\.?$/i.test(text.trim()),
  },
];

export const instructionFollow: EvalSuite = {
  id: "capability.instruction-follow",
  name: "Instruction follow",
  description: "Short exact-format prompts (JSON, arithmetic, constrained replies).",
  kind: "capability",
  run: (context) =>
    runTextCases(
      context,
      CASES.map((spec) => ({
        id: spec.id,
        prompt: spec.prompt,
        timeoutMs: 60_000,
        grade: spec.check,
      })),
    ),
};
