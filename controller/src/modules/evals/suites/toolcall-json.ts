import { Effect } from "effect";
import type { EvalCaseResult } from "@local-studio/contracts/evals";
import type { EvalChatTool } from "../eval-chat";
import { previewText, type EvalSuite } from "./types";
import { summarizeCases } from "./run-cases";

const weatherTool: EvalChatTool = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Look up the current weather for a city.",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
};

const searchTool: EvalChatTool = {
  type: "function",
  function: {
    name: "search_docs",
    description: "Search product documentation.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
};

const addTool: EvalChatTool = {
  type: "function",
  function: {
    name: "add_numbers",
    description: "Add two numbers.",
    parameters: {
      type: "object",
      properties: {
        left: { type: "number" },
        right: { type: "number" },
      },
      required: ["left", "right"],
    },
  },
};

const CASES: Array<{
  id: string;
  prompt: string;
  tools: EvalChatTool[];
  expectName: string;
  checkArgs: (raw: string) => boolean;
}> = [
  {
    id: "weather-paris",
    prompt: "What is the weather in Paris today? Use a tool; do not guess.",
    tools: [weatherTool],
    expectName: "get_weather",
    checkArgs: (raw) => /paris/i.test(raw),
  },
  {
    id: "search-install",
    prompt: "Search the docs for how to install vLLM. Use a tool.",
    tools: [searchTool],
    expectName: "search_docs",
    checkArgs: (raw) => /vllm|install/i.test(raw),
  },
  {
    id: "add-21-21",
    prompt: "Use a tool to add 21 and 21.",
    tools: [addTool],
    expectName: "add_numbers",
    checkArgs: (raw): boolean => {
      try {
        const parsed = JSON.parse(raw) as { left?: unknown; right?: unknown };
        return Number(parsed.left) === 21 && Number(parsed.right) === 21;
      } catch {
        return /21/.test(raw);
      }
    },
  },
];

export const toolcallJson: EvalSuite = {
  id: "capability.toolcall-json",
  name: "Tool calls",
  description: "Valid structured tool calls against the OpenAI tools API.",
  kind: "capability",
  run: (context) =>
    Effect.gen(function* () {
      const cases: EvalCaseResult[] = [];
      for (const spec of CASES) {
        const started = performance.now();
        const result = yield* context
          .complete({
            messages: [{ role: "user", content: spec.prompt }],
            tools: spec.tools,
            timeoutMs: 60_000,
          })
          .pipe(
            Effect.map((completion) => ({ completion, error: null as string | null })),
            Effect.catch((error) =>
              Effect.succeed({
                completion: {
                  content: "",
                  toolCalls: [],
                  promptTokens: 0,
                  completionTokens: 0,
                  ttftMs: null,
                  wallMs: 0,
                },
                error: error.message,
              }),
            ),
          );
        const call = result.completion.toolCalls.find((entry) => entry.name === spec.expectName);
        const passed =
          result.error === null && Boolean(call) && spec.checkArgs(call?.arguments ?? "");
        cases.push({
          case_id: spec.id,
          passed,
          score: passed ? 1 : 0,
          metrics: { tool_calls: result.completion.toolCalls.length },
          output_preview: previewText(
            call
              ? `${call.name} ${call.arguments}`
              : result.completion.content || result.error || "",
          ),
          error: result.error,
          duration_ms: Math.round(performance.now() - started),
        });
        yield* context.log(`${spec.id}: ${passed ? "pass" : "fail"}`);
      }
      return summarizeCases(cases);
    }),
};
