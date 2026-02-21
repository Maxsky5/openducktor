import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentRole } from "@openducktor/core";

export const toBaseUrl = (port: number): string => `http://127.0.0.1:${port}`;

export const runningStates = new Set([
  "starting",
  "running",
  "blocked",
  "awaiting_done_confirmation",
]);

export const now = (): string => new Date().toISOString();
export const READ_ONLY_ROLES = new Set<AgentRole>(["spec", "planner", "qa"]);

export const sanitizeStreamingText = (value: string): string => {
  return value.replace(/\n{3,}/g, "\n\n").trimStart();
};

export const shouldReattachListenerForAttachedSession = (
  status: AgentSessionState["status"] | null | undefined,
  hasActiveUnsubscriber: boolean,
): boolean => status !== "error" && !hasActiveUnsubscriber;

export const isDuplicateAssistantMessage = (
  messages: AgentChatMessage[],
  incomingContent: string,
  incomingTimestamp: string,
): boolean => {
  const normalizedIncoming = incomingContent.trim();
  if (normalizedIncoming.length === 0) {
    return false;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (!entry || entry.role !== "assistant") {
      continue;
    }

    const normalizedExisting = entry.content.trim();
    if (normalizedExisting !== normalizedIncoming) {
      return false;
    }

    if (entry.timestamp === incomingTimestamp) {
      return true;
    }

    const existingEpoch = Date.parse(entry.timestamp);
    const incomingEpoch = Date.parse(incomingTimestamp);
    if (Number.isNaN(existingEpoch) || Number.isNaN(incomingEpoch)) {
      return false;
    }
    return Math.abs(incomingEpoch - existingEpoch) <= 2_000;
  }

  return false;
};
