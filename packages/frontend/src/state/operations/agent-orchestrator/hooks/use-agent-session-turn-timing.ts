import { useCallback } from "react";
import {
  createSessionMessagesState,
  getSessionMessagesSlice,
} from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  type AssistantTurnTimingState,
  readAssistantActivityStartedAtMsFromMessages,
  resolveAssistantTurnDurationMs,
} from "../support/assistant-turn-duration";

type UseAgentSessionTurnTimingArgs = {
  assistantTurnTimingBySessionRef: {
    current: Record<string, AssistantTurnTimingState>;
  };
};

export const useAgentSessionTurnTiming = ({
  assistantTurnTimingBySessionRef,
}: UseAgentSessionTurnTimingArgs) => {
  const toTimestampMs = useCallback((timestamp: string | number): number | undefined => {
    if (typeof timestamp === "number") {
      return Number.isFinite(timestamp) ? timestamp : undefined;
    }

    const parsed = Date.parse(timestamp);
    return Number.isNaN(parsed) ? undefined : parsed;
  }, []);

  const recordTurnActivityTimestamp = useCallback(
    (externalSessionId: string, timestamp: string | number): void => {
      const timestampMs = toTimestampMs(timestamp);
      if (timestampMs === undefined) {
        return;
      }
      const current =
        assistantTurnTimingBySessionRef.current[externalSessionId]?.activityStartedAtMs;
      assistantTurnTimingBySessionRef.current[externalSessionId] = {
        ...(assistantTurnTimingBySessionRef.current[externalSessionId] ?? {}),
        activityStartedAtMs:
          typeof current === "number" ? Math.min(current, timestampMs) : timestampMs,
      };
    },
    [assistantTurnTimingBySessionRef, toTimestampMs],
  );

  const recordTurnUserMessageTimestamp = useCallback(
    (externalSessionId: string, timestamp: string | number): number | undefined => {
      const timestampMs = toTimestampMs(timestamp);
      if (timestampMs === undefined) {
        return assistantTurnTimingBySessionRef.current[externalSessionId]?.userAnchorAtMs;
      }
      const current = assistantTurnTimingBySessionRef.current[externalSessionId]?.userAnchorAtMs;
      const userAnchorAtMs =
        typeof current === "number" ? Math.min(current, timestampMs) : timestampMs;
      assistantTurnTimingBySessionRef.current[externalSessionId] = {
        ...(assistantTurnTimingBySessionRef.current[externalSessionId] ?? {}),
        userAnchorAtMs,
      };
      return userAnchorAtMs;
    },
    [assistantTurnTimingBySessionRef, toTimestampMs],
  );

  const readTurnUserMessageStartedAtMs = useCallback(
    (externalSessionId: string): number | undefined =>
      assistantTurnTimingBySessionRef.current[externalSessionId]?.userAnchorAtMs,
    [assistantTurnTimingBySessionRef],
  );

  const resolveTurnDurationMs = useCallback(
    (
      externalSessionId: string,
      timestamp: string,
      messages: AgentSessionState["messages"] = createSessionMessagesState(externalSessionId),
    ): number | undefined => {
      const completedAtMs = toTimestampMs(timestamp) ?? Date.now();
      const currentTiming = assistantTurnTimingBySessionRef.current[externalSessionId] ?? {};
      const previousAssistantCompletedAtMs = currentTiming.previousAssistantCompletedAtMs;
      const activityStartedAtMs =
        currentTiming.activityStartedAtMs ??
        readAssistantActivityStartedAtMsFromMessages({
          messages: getSessionMessagesSlice({ externalSessionId, messages }, 0),
          previousAssistantCompletedAtMs,
          completedAtMs,
        });
      const userAnchorAtMs = currentTiming.userAnchorAtMs;
      return resolveAssistantTurnDurationMs({
        completedAtMs,
        ...(typeof activityStartedAtMs === "number" ? { activityStartedAtMs } : {}),
        ...(typeof userAnchorAtMs === "number" ? { userAnchorAtMs } : {}),
        ...(typeof previousAssistantCompletedAtMs === "number"
          ? { previousAssistantCompletedAtMs }
          : {}),
      });
    },
    [assistantTurnTimingBySessionRef, toTimestampMs],
  );

  const clearTurnDuration = useCallback(
    (externalSessionId: string, completedTimestamp?: string): void => {
      const completedAtMs =
        completedTimestamp === undefined ? undefined : toTimestampMs(completedTimestamp);
      const nextTiming = { ...(assistantTurnTimingBySessionRef.current[externalSessionId] ?? {}) };
      delete nextTiming.activityStartedAtMs;
      delete nextTiming.userAnchorAtMs;
      if (typeof completedAtMs === "number") {
        nextTiming.previousAssistantCompletedAtMs = completedAtMs;
      }
      if (Object.keys(nextTiming).length === 0) {
        delete assistantTurnTimingBySessionRef.current[externalSessionId];
        return;
      }
      assistantTurnTimingBySessionRef.current[externalSessionId] = nextTiming;
    },
    [assistantTurnTimingBySessionRef, toTimestampMs],
  );

  return {
    recordTurnActivityTimestamp,
    recordTurnUserMessageTimestamp,
    readTurnUserMessageStartedAtMs,
    resolveTurnDurationMs,
    clearTurnDuration,
  };
};
