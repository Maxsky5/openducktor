import type { AgentStreamPart } from "@openducktor/core";
import type { AgentChatMessage } from "@/types/agent-orchestrator";

export type AssistantTurnDurationWindow = {
  activityStartedAtMs?: number;
  userAnchorAtMs?: number;
  previousAssistantCompletedAtMs?: number;
  completedAtMs: number;
};

const isFiniteTimestamp = (value: number | undefined): value is number => {
  return typeof value === "number" && Number.isFinite(value);
};

export const mergeTurnActivityTimestamp = (
  currentTimestampMs: number | undefined,
  candidateTimestampMs: number | undefined,
): number | undefined => {
  if (!isFiniteTimestamp(candidateTimestampMs)) {
    return currentTimestampMs;
  }
  if (!isFiniteTimestamp(currentTimestampMs)) {
    return candidateTimestampMs;
  }

  return Math.min(currentTimestampMs, candidateTimestampMs);
};

const resolveBoundedUserAnchorAtMs = ({
  userAnchorAtMs,
  previousAssistantCompletedAtMs,
  completedAtMs,
}: {
  userAnchorAtMs: number | undefined;
  previousAssistantCompletedAtMs: number | undefined;
  completedAtMs: number;
}): number | undefined => {
  if (!isFiniteTimestamp(userAnchorAtMs)) {
    return undefined;
  }
  if (userAnchorAtMs > completedAtMs) {
    return undefined;
  }
  if (
    isFiniteTimestamp(previousAssistantCompletedAtMs) &&
    userAnchorAtMs < previousAssistantCompletedAtMs
  ) {
    return undefined;
  }

  return userAnchorAtMs;
};

export const resolveAssistantTurnDurationMs = ({
  activityStartedAtMs,
  userAnchorAtMs,
  previousAssistantCompletedAtMs,
  completedAtMs,
}: AssistantTurnDurationWindow): number | undefined => {
  if (!isFiniteTimestamp(completedAtMs)) {
    return undefined;
  }

  const startedAtMs =
    mergeTurnActivityTimestamp(undefined, activityStartedAtMs) ??
    resolveBoundedUserAnchorAtMs({ userAnchorAtMs, previousAssistantCompletedAtMs, completedAtMs });
  if (!isFiniteTimestamp(startedAtMs)) {
    return undefined;
  }
  if (completedAtMs < startedAtMs) {
    return undefined;
  }

  return Math.max(0, completedAtMs - startedAtMs);
};

const readPartActivityStartedAtMs = (part: AgentStreamPart): number | undefined => {
  if (part.kind === "tool" || part.kind === "subagent") {
    return part.startedAtMs;
  }

  return undefined;
};

export const readAssistantActivityStartedAtMsFromParts = (
  parts: AgentStreamPart[],
  fallbackTimestampMs?: number,
): number | undefined => {
  let activityStartedAtMs: number | undefined;
  let hasAssistantOwnedPart = false;

  for (const part of parts) {
    if (
      part.kind !== "text" &&
      part.kind !== "reasoning" &&
      part.kind !== "tool" &&
      part.kind !== "subagent"
    ) {
      continue;
    }

    hasAssistantOwnedPart = true;
    activityStartedAtMs = mergeTurnActivityTimestamp(
      activityStartedAtMs,
      readPartActivityStartedAtMs(part),
    );
  }

  if (isFiniteTimestamp(activityStartedAtMs)) {
    return activityStartedAtMs;
  }

  return hasAssistantOwnedPart && isFiniteTimestamp(fallbackTimestampMs)
    ? fallbackTimestampMs
    : undefined;
};

const readChatMessageTimestampMs = (message: AgentChatMessage): number | undefined => {
  const parsed = Date.parse(message.timestamp);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const readChatMessageActivityStartedAtMs = (message: AgentChatMessage): number | undefined => {
  if (message.role === "assistant") {
    return readChatMessageTimestampMs(message);
  }
  if (message.role === "tool" && message.meta?.kind === "tool") {
    return mergeTurnActivityTimestamp(
      message.meta.startedAtMs,
      mergeTurnActivityTimestamp(
        message.meta.observedStartedAtMs,
        readChatMessageTimestampMs(message),
      ),
    );
  }
  if (message.role === "system" && message.meta?.kind === "subagent") {
    return mergeTurnActivityTimestamp(
      message.meta.startedAtMs,
      readChatMessageTimestampMs(message),
    );
  }

  return undefined;
};

export const readAssistantActivityStartedAtMsFromMessages = ({
  messages,
  previousAssistantCompletedAtMs,
  completedAtMs,
}: {
  messages: AgentChatMessage[];
  previousAssistantCompletedAtMs: number | undefined;
  completedAtMs: number;
}): number | undefined => {
  let activityStartedAtMs: number | undefined;

  for (const message of messages) {
    const timestampMs = readChatMessageTimestampMs(message);
    if (!isFiniteTimestamp(timestampMs)) {
      continue;
    }
    if (timestampMs > completedAtMs) {
      continue;
    }
    if (
      isFiniteTimestamp(previousAssistantCompletedAtMs) &&
      timestampMs <= previousAssistantCompletedAtMs
    ) {
      continue;
    }

    activityStartedAtMs = mergeTurnActivityTimestamp(
      activityStartedAtMs,
      readChatMessageActivityStartedAtMs(message),
    );
  }

  return activityStartedAtMs;
};
