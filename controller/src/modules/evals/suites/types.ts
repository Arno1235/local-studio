import type { Effect } from "effect";
import type { EvalCaseResult, EvalSuiteKind } from "@local-studio/contracts/evals";
import type { EvalChatCompletion, EvalChatMessage, EvalChatTool, EvalChatError } from "../eval-chat";

export type EvalSuiteOutcome = {
  score: number;
  displayScore: string;
  metrics: Record<string, number | null>;
  cases: EvalCaseResult[];
};

export type EvalSuiteContext = {
  modelId: string;
  maxModelLen: number;
  signal: AbortSignal;
  complete: (input: {
    messages: EvalChatMessage[];
    tools?: EvalChatTool[];
    stream?: boolean;
    timeoutMs?: number;
  }) => Effect.Effect<EvalChatCompletion, EvalChatError>;
  log: (line: string) => Effect.Effect<void>;
};

export type EvalSuite = {
  id: string;
  name: string;
  description: string;
  kind: EvalSuiteKind;
  run: (context: EvalSuiteContext) => Effect.Effect<EvalSuiteOutcome, EvalChatError>;
};

export const previewText = (value: string, limit = 240): string => {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}…`;
};

export const mean = (values: number[]): number | null => {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export const extractJson = (text: string): unknown => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
};

export const extractCode = (text: string): string => {
  const fenced = text.match(/```(?:javascript|js|typescript|ts)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? text).trim();
};
