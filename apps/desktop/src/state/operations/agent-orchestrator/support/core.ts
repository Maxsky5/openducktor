import type { AgentRole } from "@openducktor/core";
import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";

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

type RefValue<T> = { current: T };

export const createRepoStaleGuard = ({
  repoPath,
  repoEpochRef,
  activeRepoRef,
  previousRepoRef,
}: {
  repoPath: string;
  repoEpochRef: RefValue<number>;
  activeRepoRef: RefValue<string | null> | undefined;
  previousRepoRef: RefValue<string | null>;
}): (() => boolean) => {
  const repoEpochAtStart = repoEpochRef.current;
  const currentRepoAt = (): string | null => activeRepoRef?.current ?? previousRepoRef.current;
  return (): boolean => repoEpochRef.current !== repoEpochAtStart || currentRepoAt() !== repoPath;
};

export const throwIfRepoStale = (isStaleRepoOperation: () => boolean, message: string): void => {
  if (isStaleRepoOperation()) {
    throw new Error(message);
  }
};

export const normalizeWorkingDirectory = (workingDirectory: string | null | undefined): string => {
  let normalized = workingDirectory?.trim() ?? "";
  while (normalized.length > 1 && /[\\/]/.test(normalized.at(-1) ?? "")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
};

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
