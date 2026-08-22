import { hasRuntimeType } from "@openducktor/contracts";
import type { AgentStreamPart } from "@openducktor/core";
import {
  applyClaudeTaskToolResult,
  type ClaudeTodoState,
  claudeTodoToolPresentation,
} from "./claude-agent-sdk-todos";
import { createClaudeCompletedToolPart } from "./claude-agent-sdk-transcript-parts";
import type { JsonValue } from "@openducktor/contracts";

type CompletedToolPart = Extract<AgentStreamPart, { kind: "tool" }>;

type ProjectClaudeCompletedToolResultInput = {
  callId: string;
  endedAtMs: number;
  input?: Record<string, JsonValue>;
  isError: boolean;
  messageId: string;
  metadata?: Record<string, JsonValue>;
  preview?: string;
  raw: Record<string, JsonValue>;
  resultText: string;
  startedAtMs?: number;
  state: ClaudeTodoState;
  tool: string;
};

export const projectClaudeCompletedToolResult = ({
  callId,
  endedAtMs,
  input,
  isError,
  messageId,
  metadata,
  preview,
  raw,
  resultText,
  startedAtMs,
  state,
  tool,
}: ProjectClaudeCompletedToolResultInput) => {
  const todos = applyClaudeTaskToolResult({ input, isError, raw, state, tool });
  const todoPresentation = todos ? claudeTodoToolPresentation(todos) : null;
  return {
    todos,
    part: createClaudeCompletedToolPart({
      callId,
      endedAtMs,
      isError,
      messageId,
      raw,
      tool,
      ...(todoPresentation ?? {
        text: resultText,
        ...(() => {
          if (input) {
            return { input };
          }
          return {};
        })(),
        ...(() => {
          if (preview) {
            return { preview };
          }
          return {};
        })(),
      }),
      ...(() => {
        if (metadata) {
          return { metadata };
        }
        return {};
      })(),
      ...(() => {
        if (hasRuntimeType(startedAtMs, "number")) {
          return { startedAtMs };
        }
        return {};
      })(),
    }),
  } satisfies {
    part: CompletedToolPart;
    todos: ReturnType<typeof applyClaudeTaskToolResult>;
  };
};
