import type { AgentStreamPart } from "@openducktor/core";
import {
  applyClaudeTaskToolResult,
  type ClaudeTodoState,
  claudeTodoToolPresentation,
} from "./claude-agent-sdk-todos";
import { createClaudeCompletedToolPart } from "./claude-agent-sdk-transcript-parts";
import type { ClaudeDecodedToolResult, ClaudeDecodedToolUse } from "./claude-agent-sdk-tool-shapes";

type CompletedToolPart = Extract<AgentStreamPart, { kind: "tool" }>;

type ProjectClaudeCompletedToolResultInput = {
  callId: string;
  endedAtMs: number;
  input?: ClaudeDecodedToolUse["input"];
  isError: boolean;
  messageId: string;
  metadata?: CompletedToolPart["metadata"];
  preview?: string;
  raw: ClaudeDecodedToolResult["raw"];
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
  const completedToolInput: Parameters<typeof createClaudeCompletedToolPart>[0] = {
    callId,
    endedAtMs,
    isError,
    messageId,
    raw,
    text: todoPresentation?.text ?? resultText,
    tool,
  };
  const resolvedInput = todoPresentation?.input ?? input;
  if (resolvedInput) {
    completedToolInput.input = resolvedInput;
  }
  if (!todoPresentation && preview) {
    completedToolInput.preview = preview;
  }
  if (metadata) {
    completedToolInput.metadata = metadata;
  }
  if (startedAtMs !== undefined) {
    completedToolInput.startedAtMs = startedAtMs;
  }
  return {
    todos,
    part: createClaudeCompletedToolPart(completedToolInput),
  } satisfies {
    part: CompletedToolPart;
    todos: ReturnType<typeof applyClaudeTaskToolResult>;
  };
};
