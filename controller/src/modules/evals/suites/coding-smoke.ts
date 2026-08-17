import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { EvalCaseResult } from "@local-studio/contracts/evals";
import { extractCode, previewText, type EvalSuite } from "./types";
import { summarizeCases } from "./run-cases";

type CodingCase = {
  id: string;
  name: string;
  prompt: string;
  tests: Array<{ args: unknown[]; expected: unknown }>;
};

const CASES: CodingCase[] = [
  {
    id: "reverse-string",
    name: "reverseString",
    prompt:
      "Write a JavaScript function reverseString(s) that returns s reversed. Reply with only the function.",
    tests: [
      { args: ["hello"], expected: "olleh" },
      { args: [""], expected: "" },
      { args: ["ab"], expected: "ba" },
    ],
  },
  {
    id: "is-palindrome",
    name: "isPalindrome",
    prompt:
      "Write a JavaScript function isPalindrome(s) that returns true if s reads the same forwards and backwards, ignoring case. Reply with only the function.",
    tests: [
      { args: ["Abba"], expected: true },
      { args: ["hello"], expected: false },
    ],
  },
  {
    id: "sum-array",
    name: "sumArray",
    prompt:
      "Write a JavaScript function sumArray(nums) that returns the sum of numbers in nums. Reply with only the function.",
    tests: [
      { args: [[1, 2, 3]], expected: 6 },
      { args: [[]], expected: 0 },
    ],
  },
  {
    id: "factorial",
    name: "factorial",
    prompt:
      "Write a JavaScript function factorial(n) that returns n! for integer n >= 0. Reply with only the function.",
    tests: [
      { args: [0], expected: 1 },
      { args: [5], expected: 120 },
    ],
  },
  {
    id: "unique-sorted",
    name: "uniqueSorted",
    prompt:
      "Write a JavaScript function uniqueSorted(nums) that returns the unique numbers from nums sorted ascending. Reply with only the function.",
    tests: [
      { args: [[3, 1, 2, 3]], expected: [1, 2, 3] },
      { args: [[5]], expected: [5] },
    ],
  },
];

const runFunctionTests = (
  name: string,
  code: string,
  tests: CodingCase["tests"],
): Effect.Effect<{ passed: boolean; detail: string }, never> =>
  Effect.tryPromise({
    try: async () => {
      const dir = await mkdtemp(join(tmpdir(), "ls-eval-"));
      const file = join(dir, "case.mjs");
      const source = `${code}\n
const tests = ${JSON.stringify(tests)};
const fn = typeof ${name} === "function" ? ${name} : null;
if (!fn) {
  console.log(JSON.stringify({ ok: false, error: "missing ${name}" }));
  process.exit(0);
}
const results = tests.map((entry, index) => {
  try {
    const got = fn(...entry.args);
    return { index, pass: JSON.stringify(got) === JSON.stringify(entry.expected), got };
  } catch (error) {
    return { index, pass: false, error: String(error) };
  }
});
console.log(JSON.stringify({ ok: true, results }));
`;
      await writeFile(file, source, "utf8");
      try {
        const proc = Bun.spawn(["bun", "run", file], {
          stdout: "pipe",
          stderr: "pipe",
          signal: AbortSignal.timeout(5_000),
        });
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;
        const line = stdout.trim().split("\n").at(-1) ?? "";
        let parsed: { ok?: boolean; error?: string; results?: Array<{ pass: boolean }> };
        try {
          parsed = JSON.parse(line) as {
            ok?: boolean;
            error?: string;
            results?: Array<{ pass: boolean }>;
          };
        } catch {
          return { passed: false, detail: stderr || stdout || "invalid harness output" };
        }
        if (!parsed.ok) return { passed: false, detail: parsed.error ?? (stderr || "no function") };
        const passed = (parsed.results ?? []).every((entry) => entry.pass) && exitCode === 0;
        return { passed, detail: passed ? "ok" : stderr || line };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    catch: (error) => (error instanceof Error ? error.message : String(error)),
  }).pipe(Effect.catch((detail) => Effect.succeed({ passed: false, detail })));

export const codingSmoke: EvalSuite = {
  id: "capability.coding-smoke",
  name: "Coding smoke",
  description: "Small JavaScript functions with hidden unit checks.",
  kind: "capability",
  run: (context) =>
    Effect.gen(function* () {
      const cases: EvalCaseResult[] = [];
      for (const spec of CASES) {
        const started = performance.now();
        const completion = yield* context
          .complete({
            messages: [{ role: "user", content: spec.prompt }],
            timeoutMs: 90_000,
          })
          .pipe(
            Effect.map((value) => ({ text: value.content, error: null as string | null })),
            Effect.catch((error) => Effect.succeed({ text: "", error: error.message })),
          );
        const code = extractCode(completion.text);
        const checked =
          completion.error === null && code
            ? yield* runFunctionTests(spec.name, code, spec.tests)
            : { passed: false, detail: completion.error ?? "empty output" };
        cases.push({
          case_id: spec.id,
          passed: checked.passed,
          score: checked.passed ? 1 : 0,
          metrics: {},
          output_preview: previewText(code || completion.text),
          error: checked.passed ? null : checked.detail,
          duration_ms: Math.round(performance.now() - started),
        });
        yield* context.log(`${spec.id}: ${checked.passed ? "pass" : "fail"}`);
      }
      return summarizeCases(cases);
    }),
};
