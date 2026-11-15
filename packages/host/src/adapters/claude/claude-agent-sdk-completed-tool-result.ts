import type { AgentStreamPart } from "@openducktor/core";
import {
  applyClaudeTaskToolResult,
  type ClaudeTodoState,
  claudeTodoToolPresentation,
} from "./claude-agent-sdk-todos";
import { isClaudeProtocolObject } from "./claude-agent-sdk-ingress-schemas";
import { createClaudeCompletedToolPart } from "./claude-agent-sdk-transcript-parts";
import type { ClaudeDecodedToolResult, ClaudeDecodedToolUse } from "./claude-agent-sdk-tool-shapes";
import { toolPartType } from "./claude-agent-sdk-utils";

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

/**
 * Claude gives the answers of a question tool only in its structured result, as a record with the
 * text of each question as its key. The tool part keeps them in its metadata, as OpenCode does.
 */
const withClaudeQuestionAnswers = (
  tool: string,
  raw: ClaudeDecodedToolResult["raw"],
  metadata: CompletedToolPart["metadata"],
): CompletedToolPart["metadata"] => {
  if (toolPartType(tool) !== "question") return metadata;
  const result = raw.toolUseResult;
  if (!isClaudeProtocolObject(result) || !isClaudeProtocolObject(result.answers)) return metadata;
  return { ...metadata, answers: result.answers };
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
  const resolvedMetadata = isError ? metadata : withClaudeQuestionAnswers(tool, raw, metadata);
  if (resolvedMetadata) {
    completedToolInput.metadata = resolvedMetadata;
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
