import type { AgentModelSelection } from "@openducktor/core";
import type {
  ClaudeHistoryEntryMetadata,
  ClaudeHistoryMessage,
} from "./claude-agent-sdk-history-import";
import { isClaudeSyntheticAssistantMessage } from "./claude-agent-sdk-local-commands";
import { isRecord, readStringProp } from "./claude-agent-sdk-utils";

export const readHistoryTimestamp = (entry: ClaudeHistoryMessage, now: () => string): string => {
  const timestamp = isRecord(entry) ? (entry as ClaudeHistoryEntryMetadata).timestamp : undefined;
  if (typeof timestamp !== "string") {
    return now();
  }
  return Number.isNaN(Date.parse(timestamp)) ? now() : timestamp;
};

export const readHistorySessionId = (entry: ClaudeHistoryMessage): string =>
  readStringProp(entry, "session_id") ?? readStringProp(entry, "sessionId") ?? "claude-history";

export const readHistoryAssistantModel = (
  entry: ClaudeHistoryMessage,
): AgentModelSelection | undefined => {
  if (isClaudeSyntheticAssistantMessage(entry)) {
    return undefined;
  }
  const model = isRecord(entry) ? readStringProp(entry.message, "model") : undefined;
  return model
    ? {
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }
    : undefined;
};

export const isNestedHistoryEntry = (entry: ClaudeHistoryMessage): boolean => {
  if (entry.type === "result" || !isRecord(entry)) {
    return false;
  }
  if (entry.type === "system") {
    const subtype = readStringProp(entry, "subtype");
    if (
      subtype === "task_started" ||
      subtype === "task_progress" ||
      subtype === "task_updated" ||
      subtype === "task_notification"
    ) {
      return false;
    }
  }
  const metadata = entry as ClaudeHistoryEntryMetadata;
  const subagentType = metadata.subagent_type;
  return (
    (entry.type === "assistant" && Boolean(entry.parent_tool_use_id)) ||
    metadata.isSidechain === true ||
    (typeof subagentType === "string" && subagentType.trim().length > 0)
  );
};
