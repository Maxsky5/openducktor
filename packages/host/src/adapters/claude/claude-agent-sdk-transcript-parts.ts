import type { AgentEvent, AgentStreamPart } from "@openducktor/core";
import { readClaudeFileEditPayload } from "./claude-agent-sdk-file-edits";
import { parseClaudeCanonicalJsonObject } from "./claude-agent-sdk-ingress-schemas";
import type { ClaudeDecodedToolResult } from "./claude-agent-sdk-tool-shapes";
import type { ClaudeToolInput } from "./claude-agent-sdk-types";
import { previewInput, toolPartPresentation } from "./claude-agent-sdk-utils";

type ClaudeTextPart = Extract<AgentStreamPart, { kind: "text" }>;
type ClaudeReasoningPart = Extract<AgentStreamPart, { kind: "reasoning" }>;
type ClaudeToolPart = Extract<AgentStreamPart, { kind: "tool" }>;
type ClaudeFinishStepPart = Extract<AgentStreamPart, { kind: "step" }>;

export const createClaudeAssistantTextPart = ({
  messageId,
  partId = `${messageId}:text`,
  text,
}: {
  messageId: string;
  partId?: string;
  text: string;
}): ClaudeTextPart => ({
  kind: "text",
  messageId,
  partId,
  text,
  completed: true,
});

export const createClaudeAssistantReasoningPart = ({
  messageId,
  partId,
  text,
}: {
  messageId: string;
  partId: string;
  text: string;
}): ClaudeReasoningPart => ({
  kind: "reasoning",
  messageId,
  partId,
  text,
  completed: true,
});

export const createClaudeFinishStepPart = ({
  messageId,
  reason,
}: {
  messageId: string;
  reason: string;
}): ClaudeFinishStepPart => ({
  kind: "step",
  messageId,
  partId: `${messageId}:finish`,
  phase: "finish",
  reason,
});

export const createClaudeCompletedToolPart = ({
  callId,
  endedAtMs,
  input,
  isError,
  messageId,
  metadata,
  preview,
  raw,
  startedAtMs,
  text,
  tool,
}: {
  callId: string;
  endedAtMs: number;
  input?: ClaudeToolInput;
  isError: boolean;
  messageId: string;
  metadata?: NonNullable<ClaudeToolPart["metadata"]>;
  preview?: string;
  raw?: ClaudeDecodedToolResult["raw"];
  startedAtMs?: number;
  text: string;
  tool: string;
}): ClaudeToolPart => {
  const resolvedPreview = preview ?? (input ? previewInput(input) : undefined);
  const canonicalInput = input
    ? parseClaudeCanonicalJsonObject(input, "claudeToolInput")
    : undefined;
  const canonicalMetadata = metadata
    ? parseClaudeCanonicalJsonObject(metadata, "claudeToolMetadata")
    : undefined;
  const part: ClaudeToolPart = {
    kind: "tool",
    messageId,
    partId: callId,
    callId,
    tool,
    ...toolPartPresentation(tool),
    status: isError ? "error" : "completed",
    endedAtMs,
  };
  if (canonicalInput) {
    part.input = canonicalInput;
  }
  if (resolvedPreview) {
    part.preview = resolvedPreview;
  }
  if (canonicalMetadata) {
    part.metadata = canonicalMetadata;
  }
  if (startedAtMs !== undefined) {
    part.startedAtMs = startedAtMs;
  }
  if (isError) {
    part.error = text;
  } else {
    part.output = text;
  }
  if (!isError && raw) {
    Object.assign(part, readClaudeFileEditPayload({ tool, input, raw }));
  }
  return part;
};

export const claudeAssistantTextPartEvent = ({
  externalSessionId,
  messageId,
  partId,
  text,
  timestamp,
}: {
  externalSessionId: string;
  messageId: string;
  partId?: string;
  text: string;
  timestamp: string;
}): AgentEvent => ({
  type: "assistant_part",
  externalSessionId,
  timestamp,
  part: createClaudeAssistantTextPart(partId ? { messageId, partId, text } : { messageId, text }),
});
