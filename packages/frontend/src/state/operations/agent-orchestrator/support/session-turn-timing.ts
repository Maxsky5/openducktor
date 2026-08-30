import type { AgentSessionState } from "@/types/agent-orchestrator";
import { z } from "zod";
import {
  type AssistantTurnTimingState,
  readAssistantActivityStartedAtMsFromMessages,
  resolveAssistantTurnDurationMs,
} from "./assistant-turn-duration";
import { createSessionMessagesState, getSessionMessagesSlice } from "./messages";

export type SessionTurnTiming = {
  recordTurnActivityTimestamp: (sessionKey: string, timestamp: string | number) => void;
  recordTurnUserMessageTimestamp: (
    sessionKey: string,
    timestamp: string | number,
  ) => number | undefined;
  readTurnUserMessageStartedAtMs: (sessionKey: string) => number | undefined;
  resolveTurnDurationMs: (
    sessionKey: string,
    externalSessionId: string,
    timestamp: string,
    messages?: AgentSessionState["messages"],
  ) => number | undefined;
  clearTurnDuration: (sessionKey: string, completedTimestamp?: string) => void;
  clearSession: (sessionKey: string) => void;
  clearAll: () => void;
};

const numericTimestampSchema = z.number();
const isNumericTimestamp = (timestamp: string | number): timestamp is number =>
  numericTimestampSchema.safeParse(timestamp).success;

const toTimestampMs = (timestamp: string | number): number | undefined => {
  if (isNumericTimestamp(timestamp)) {
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }

  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? undefined : parsed;
};

export const createSessionTurnTiming = (): SessionTurnTiming => {
  const timingBySession: Record<string, AssistantTurnTimingState> = {};

  const clearSession = (sessionKey: string): void => {
    delete timingBySession[sessionKey];
  };

  return {
    recordTurnActivityTimestamp: (sessionKey, timestamp) => {
      const timestampMs = toTimestampMs(timestamp);
      if (timestampMs === undefined) {
        return;
      }
      const current = timingBySession[sessionKey]?.activityStartedAtMs;
      timingBySession[sessionKey] = {
        ...timingBySession[sessionKey],
        activityStartedAtMs: current !== undefined ? Math.min(current, timestampMs) : timestampMs,
      };
    },
    recordTurnUserMessageTimestamp: (sessionKey, timestamp) => {
      const timestampMs = toTimestampMs(timestamp);
      if (timestampMs === undefined) {
        return timingBySession[sessionKey]?.userAnchorAtMs;
      }
      const current = timingBySession[sessionKey]?.userAnchorAtMs;
      const userAnchorAtMs = current !== undefined ? Math.min(current, timestampMs) : timestampMs;
      timingBySession[sessionKey] = {
        ...timingBySession[sessionKey],
        userAnchorAtMs,
      };
      return userAnchorAtMs;
    },
    readTurnUserMessageStartedAtMs: (sessionKey) => timingBySession[sessionKey]?.userAnchorAtMs,
    resolveTurnDurationMs: (
      sessionKey,
      externalSessionId,
      timestamp,
      messages = createSessionMessagesState(externalSessionId),
    ) => {
      const completedAtMs = toTimestampMs(timestamp) ?? Date.now();
      const currentTiming = timingBySession[sessionKey] ?? {};
      const previousAssistantCompletedAtMs = currentTiming.previousAssistantCompletedAtMs;
      const activityStartedAtMs =
        currentTiming.activityStartedAtMs ??
        readAssistantActivityStartedAtMsFromMessages({
          messages: getSessionMessagesSlice({ externalSessionId, messages }, 0),
          previousAssistantCompletedAtMs,
          completedAtMs,
        });
      const userAnchorAtMs = currentTiming.userAnchorAtMs;
      const timing: Parameters<typeof resolveAssistantTurnDurationMs>[0] = { completedAtMs };
      if (activityStartedAtMs !== undefined) {
        timing.activityStartedAtMs = activityStartedAtMs;
      }
      if (userAnchorAtMs !== undefined) {
        timing.userAnchorAtMs = userAnchorAtMs;
      }
      if (previousAssistantCompletedAtMs !== undefined) {
        timing.previousAssistantCompletedAtMs = previousAssistantCompletedAtMs;
      }
      return resolveAssistantTurnDurationMs(timing);
    },
    clearTurnDuration: (sessionKey, completedTimestamp) => {
      const completedAtMs =
        completedTimestamp === undefined ? undefined : toTimestampMs(completedTimestamp);
      const nextTiming = { ...timingBySession[sessionKey] };
      delete nextTiming.activityStartedAtMs;
      delete nextTiming.userAnchorAtMs;
      if (completedAtMs !== undefined) {
        nextTiming.previousAssistantCompletedAtMs = completedAtMs;
      }
      if (Object.keys(nextTiming).length === 0) {
        clearSession(sessionKey);
        return;
      }
      timingBySession[sessionKey] = nextTiming;
    },
    clearSession,
    clearAll: () => {
      for (const sessionKey of Object.keys(timingBySession)) {
        delete timingBySession[sessionKey];
      }
    },
  };
};
