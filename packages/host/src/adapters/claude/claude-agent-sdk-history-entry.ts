import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";
import type { AgentModelSelection } from "@openducktor/core";
import type { ClaudeHistoryMessage } from "./claude-agent-sdk-history-messages";
import { isClaudeSyntheticAssistantMessage } from "./claude-agent-sdk-local-commands";
import { readStringProp } from "./claude-agent-sdk-utils";

const claudeEffortLevels = new Set<string>([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] satisfies EffortLevel[]);

export const readHistoryTimestamp = (entry: ClaudeHistoryMessage, now: () => string): string => {
  const timestamp = readStringProp(entry, "timestamp");
  if (timestamp === undefined) {
    return now();
  }
  return Number.isNaN(Date.parse(timestamp)) ? now() : timestamp;
};

export const readHistorySessionId = (entry: ClaudeHistoryMessage): string =>
  readStringProp(entry, "session_id") ?? readStringProp(entry, "sessionId") ?? "claude-history";

export const readHistoryAssistantModel = (
  entry: ClaudeHistoryMessage,
  model: string | undefined,
): AgentModelSelection | undefined => {
  if (entry.type !== "assistant" || isClaudeSyntheticAssistantMessage(entry)) {
    return undefined;
  }
  if (!model) return undefined;
  const selection: AgentModelSelection = {
    providerId: "claude",
    modelId: model,
    runtimeKind: "claude",
  };
  const effort = readStringProp(entry, "perTurnEffort") ?? readStringProp(entry, "effort");
  if (effort && claudeEffortLevels.has(effort)) selection.variant = effort;
  return selection;
};

export const isNestedHistoryEntry = (entry: ClaudeHistoryMessage): boolean => {
  if (entry.type === "result") {
    return false;
  }
  if (entry.type === "system") {
    const subtype = readStringProp(entry, "subtype");
    if (
      subtype === "task_started" ||
      subtype === "task_progress" ||
      subtype === "task_updated" ||
      subtype === "task_notification" ||
      subtype === "background_tasks_changed"
    ) {
      return false;
    }
  }
  const subagentType = readStringProp(entry, "subagent_type");
  return (
    (entry.type === "assistant" && Boolean(entry.parent_tool_use_id)) ||
    entry.isSidechain === true ||
    subagentType !== undefined
  );
};
