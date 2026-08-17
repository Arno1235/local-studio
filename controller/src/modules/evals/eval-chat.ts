import { Effect, Schema } from "effect";
import { fetchLocal, type LocalFetchError, type LocalFetchOptions } from "../../http/local-fetch";

export type EvalChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export type EvalChatTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type EvalChatToolCall = {
  name: string;
  arguments: string;
};

export type EvalChatCompletion = {
  content: string;
  toolCalls: EvalChatToolCall[];
  promptTokens: number;
  completionTokens: number;
  ttftMs: number | null;
  wallMs: number;
};

export class EvalChatError extends Schema.TaggedErrorClass<EvalChatError>()("EvalChatError", {
  message: Schema.String,
  source: Schema.Unknown,
}) {}

export type InferenceFetch = (
  path: string,
  options?: LocalFetchOptions,
) => Effect.Effect<Response, LocalFetchError>;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

const asNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toolCallsFromMessage = (message: Record<string, unknown>): EvalChatToolCall[] => {
  const raw = message["tool_calls"];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const record = asRecord(entry);
    const functionSpec = record ? asRecord(record["function"]) : null;
    const name = functionSpec ? asString(functionSpec["name"]).trim() : "";
    if (!name) return [];
    return [{ name, arguments: functionSpec ? asString(functionSpec["arguments"]) : "{}" }];
  });
};

const parseNonStream = (payload: unknown, wallMs: number): EvalChatCompletion => {
  const root = asRecord(payload);
  const choice = Array.isArray(root?.["choices"]) ? asRecord(root["choices"][0]) : null;
  const message = choice ? asRecord(choice["message"]) : null;
  const usage = root ? asRecord(root["usage"]) : null;
  return {
    content: message ? asString(message["content"]) : "",
    toolCalls: message ? toolCallsFromMessage(message) : [],
    promptTokens: usage ? asNumber(usage["prompt_tokens"]) : 0,
    completionTokens: usage ? asNumber(usage["completion_tokens"]) : 0,
    ttftMs: null,
    wallMs,
  };
};

const parseSseChunk = (
  line: string,
): { content: string; toolCalls: EvalChatToolCall[]; usage: Record<string, unknown> | null } | null => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  try {
    const root = asRecord(JSON.parse(data));
    if (!root) return null;
    const choice = Array.isArray(root["choices"]) ? asRecord(root["choices"][0]) : null;
    const delta = choice ? asRecord(choice["delta"]) ?? asRecord(choice["message"]) : null;
    return {
      content: delta ? asString(delta["content"]) : "",
      toolCalls: delta ? toolCallsFromMessage(delta) : [],
      usage: asRecord(root["usage"]),
    };
  } catch {
    return null;
  }
};

export const createInferenceFetch = (host: string, port: number): InferenceFetch => (path, options) =>
  fetchLocal(port, path, { host, ...options });

export const completeChat = (
  fetchInference: InferenceFetch,
  input: {
    model: string;
    messages: EvalChatMessage[];
    tools?: EvalChatTool[];
    stream?: boolean;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Effect.Effect<EvalChatCompletion, EvalChatError> => {
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    temperature: 0,
    stream: input.stream === true,
  };
  if (input.tools && input.tools.length > 0) {
    body["tools"] = input.tools;
    body["tool_choice"] = "auto";
  }
  if (input.stream) body["stream_options"] = { include_usage: true };
  const started = performance.now();
  const options: LocalFetchOptions = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs: input.timeoutMs ?? 180_000,
  };
  if (input.signal) options.signal = input.signal;
  return fetchInference("/v1/chat/completions", options).pipe(
    Effect.mapError(
      (error) => new EvalChatError({ message: error.message, source: error }),
    ),
    Effect.flatMap((response) => {
      if (!response.ok) {
        return Effect.fail(
          new EvalChatError({
            message: `Chat completion failed (${response.status})`,
            source: response.status,
          }),
        );
      }
      if (!input.stream) {
        return Effect.tryPromise({
          try: () => response.json(),
          catch: (source) => new EvalChatError({ message: "Invalid chat response", source }),
        }).pipe(Effect.map((payload) => parseNonStream(payload, performance.now() - started)));
      }
      return readStreamCompletion(response, started);
    }),
  );
};

const readStreamCompletion = (
  response: Response,
  started: number,
): Effect.Effect<EvalChatCompletion, EvalChatError> =>
  Effect.tryPromise({
    try: async () => {
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Missing response body");
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";
      const toolCalls: EvalChatToolCall[] = [];
      let ttftMs: number | null = null;
      let promptTokens = 0;
      let completionTokens = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const parsed = parseSseChunk(line);
          if (!parsed) continue;
          if (parsed.content && ttftMs === null) ttftMs = performance.now() - started;
          content += parsed.content;
          for (const call of parsed.toolCalls) toolCalls.push(call);
          if (parsed.usage) {
            promptTokens = asNumber(parsed.usage["prompt_tokens"]) || promptTokens;
            completionTokens = asNumber(parsed.usage["completion_tokens"]) || completionTokens;
          }
        }
      }
      return {
        content,
        toolCalls,
        promptTokens,
        completionTokens,
        ttftMs,
        wallMs: performance.now() - started,
      };
    },
    catch: (source) => new EvalChatError({ message: "Stream read failed", source }),
  });
