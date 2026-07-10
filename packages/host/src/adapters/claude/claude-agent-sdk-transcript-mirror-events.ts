import type { SessionMessage, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent, AgentStreamPart } from "@openducktor/core";
import { isClaudeFileEditTool, readClaudeFileEditPayload } from "./claude-agent-sdk-file-edits";
import { readHistoryToolResult } from "./claude-agent-sdk-history-support";
import { timestampMs } from "./claude-agent-sdk-tool-shapes";
import type { ClaudeSession } from "./claude-agent-sdk-types";
import { isRecord, previewInput, readStringProp, toolPartType } from "./claude-agent-sdk-utils";

type ClaudeTranscriptMirrorSession = Pick<
  ClaudeSession,
  | "externalSessionId"
  | "toolInputsByCallId"
  | "toolMessageIdsByCallId"
  | "toolNamesByCallId"
  | "toolStartedAtMsByCallId"
>;

const isSessionMessageEntry = (entry: SessionStoreEntry): entry is SessionMessage =>
  entry.type === "user" &&
  typeof entry.uuid === "string" &&
  typeof entry.session_id === "string" &&
  "message" in entry &&
  "parent_tool_use_id" in entry;

const readMirroredStructuredToolResult = (
  entry: SessionStoreEntry,
): Record<string, unknown> | null => {
  const toolUseResult = entry.toolUseResult ?? entry.tool_use_result;
  return isRecord(toolUseResult) ? toolUseResult : null;
};

export const emitClaudeMirroredFileEditToolResult = ({
  emit,
  entry,
  now,
  session,
}: {
  emit: (event: AgentEvent) => void;
  entry: SessionStoreEntry;
  now: () => string;
  session: ClaudeTranscriptMirrorSession;
}): void => {
  if (!isSessionMessageEntry(entry)) {
    return;
  }
  const toolUseId = readStringProp(entry, "parent_tool_use_id");
  if (!toolUseId) {
    return;
  }
  const tool = session.toolNamesByCallId.get(toolUseId);
  if (!tool || !isClaudeFileEditTool(tool)) {
    return;
  }
  if (!readMirroredStructuredToolResult(entry)) {
    return;
  }
  const result = readHistoryToolResult(entry);
  if (!result || result.isError) {
    return;
  }
  const input = session.toolInputsByCallId.get(result.toolUseId);
  const payload = readClaudeFileEditPayload({
    tool,
    input,
    raw: result.raw,
  });
  if (!payload.fileDiffs) {
    return;
  }

  const timestamp = readStringProp(entry, "timestamp") ?? now();
  const messageId =
    session.toolMessageIdsByCallId.get(result.toolUseId) ??
    readStringProp(entry, "uuid") ??
    result.toolUseId;
  const preview = input ? previewInput(input) : undefined;
  const startedAtMs = session.toolStartedAtMsByCallId.get(result.toolUseId);
  const part: Extract<AgentStreamPart, { kind: "tool" }> = {
    kind: "tool",
    messageId,
    partId: result.toolUseId,
    callId: result.toolUseId,
    tool,
    toolType: toolPartType(tool),
    status: "completed",
    ...(input ? { input } : {}),
    ...(preview ? { preview } : {}),
    ...(typeof startedAtMs === "number" ? { startedAtMs } : {}),
    endedAtMs: timestampMs(timestamp),
    output: result.text,
    ...payload,
  };

  emit({
    type: "assistant_part",
    externalSessionId: session.externalSessionId,
    timestamp,
    part,
  });
};
