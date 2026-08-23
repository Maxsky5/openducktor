import { hasRuntimeType } from "@openducktor/contracts";
import type { AgentEvent, AgentStreamPart } from "@openducktor/core";
import { readClaudeFileEditPayload } from "./claude-agent-sdk-file-edits";
import { parseClaudeCanonicalJsonObject } from "./claude-agent-sdk-ingress-schemas";
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
  input?: Record<string, unknown>;
  isError: boolean;
  messageId: string;
  metadata?: Record<string, unknown>;
  preview?: string;
  raw?: Record<string, unknown>;
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
    ...(canonicalInput ? { input: canonicalInput } : undefined),
    ...(resolvedPreview ? { preview: resolvedPreview } : undefined),
    ...(canonicalMetadata ? { metadata: canonicalMetadata } : undefined),
    ...(hasRuntimeType(startedAtMs, "number") ? { startedAtMs } : undefined),
    endedAtMs,
    ...(isError ? { error: text } : { output: text }),
  };
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
  part: createClaudeAssistantTextPart({
    messageId,
    ...(partId ? { partId } : undefined),
    text,
  }),
});
