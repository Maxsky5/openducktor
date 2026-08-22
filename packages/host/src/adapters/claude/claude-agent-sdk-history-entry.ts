import { hasRuntimeType } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import type { JsonValue } from "@openducktor/contracts";
import type {
  ClaudeHistoryEntryMetadata,
  ClaudeHistoryMessage,
} from "./claude-agent-sdk-history-import";
import { isClaudeSyntheticAssistantMessage } from "./claude-agent-sdk-local-commands";
import { isRecord, readStringProp } from "./claude-agent-sdk-utils";
import { parseClaudeJsonValue } from "./claude-agent-sdk-ingress-schemas";

const claudeHistoryValue = (entry: ClaudeHistoryMessage): JsonValue | undefined => {
  return parseClaudeJsonValue(entry, "claudeHistoryMessage");
};

export const readHistoryTimestamp = (entry: ClaudeHistoryMessage, now: () => string): string => {
  const value = claudeHistoryValue(entry);
  // SAFETY: The runtime adapter builds this value from the contract fields required by `ClaudeHistoryEntryMetadata`.
  const timestamp = isRecord(value) ? (entry as ClaudeHistoryEntryMetadata).timestamp : undefined;
  if (!hasRuntimeType(timestamp, "string")) {
    return now();
  }
  return Number.isNaN(Date.parse(timestamp)) ? now() : timestamp;
};

export const readHistorySessionId = (entry: ClaudeHistoryMessage): string =>
  readStringProp(claudeHistoryValue(entry), "session_id") ??
  readStringProp(claudeHistoryValue(entry), "sessionId") ??
  "claude-history";

export const readHistoryAssistantModel = (
  entry: ClaudeHistoryMessage,
): AgentModelSelection | undefined => {
  const value = claudeHistoryValue(entry);
  if (isClaudeSyntheticAssistantMessage(value)) {
    return undefined;
  }
  const model = isRecord(value) ? readStringProp(value.message, "model") : undefined;
  return model
    ? {
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }
    : undefined;
};

export const isNestedHistoryEntry = (entry: ClaudeHistoryMessage): boolean => {
  const value = claudeHistoryValue(entry);
  if (entry.type === "result" || !isRecord(value)) {
    return false;
  }
  if (entry.type === "system") {
    const subtype = readStringProp(value, "subtype");
    if (
      subtype === "task_started" ||
      subtype === "task_progress" ||
      subtype === "task_updated" ||
      subtype === "task_notification"
    ) {
      return false;
    }
  }
  // SAFETY: The runtime adapter builds this value from the contract fields required by `ClaudeHistoryEntryMetadata`.
  const metadata = entry as ClaudeHistoryEntryMetadata;
  const subagentType = metadata.subagent_type;
  return (
    (entry.type === "assistant" && Boolean(entry.parent_tool_use_id)) ||
    metadata.isSidechain === true ||
    (hasRuntimeType(subagentType, "string") && subagentType.trim().length > 0)
  );
};
