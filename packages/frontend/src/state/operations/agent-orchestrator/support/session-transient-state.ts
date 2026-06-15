import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import {
  type AssistantTurnTimingState,
  readAssistantActivityStartedAtMsFromMessages,
  resolveAssistantTurnDurationMs,
} from "./assistant-turn-duration";
import { createSessionMessagesState, getSessionMessagesSlice } from "./messages";

export type DraftChannel = "reasoning";
export type DraftSource = "delta" | "part";
export type DraftChannelValueMap<T> = Partial<Record<DraftChannel, T>>;

export type SessionTransientState = {
  draftBuffers: SessionDraftBuffers;
  assistantTurnTiming: SessionTurnTiming;
  turnMetadata: SessionTurnMetadata;
};

export type SessionDraftChannelBuffer = {
  raw: string;
  source?: DraftSource;
  messageId?: string;
};

export type SessionDraftBuffers = {
  readChannel: (sessionKey: string, channel: DraftChannel) => SessionDraftChannelBuffer;
  writeChannel: (
    sessionKey: string,
    channel: DraftChannel,
    draft: SessionDraftChannelBuffer,
  ) => void;
  clearChannel: (
    sessionKey: string,
    channel: DraftChannel,
    nextDraft?: Pick<SessionDraftChannelBuffer, "source" | "messageId">,
  ) => void;
  clearFlushTimeout: (sessionKey: string) => void;
  scheduleFlush: (sessionKey: string, flush: () => void, delayMs: number) => void;
  clearSession: (sessionKey: string) => void;
  clearAll: () => void;
};

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

export type SessionTurnMetadata = {
  recordModel: (sessionKey: string, model: AgentSessionState["selectedModel"] | undefined) => void;
  readModel: (sessionKey: string) => AgentSessionState["selectedModel"] | undefined;
  recordContextUsageMessageId: (sessionKey: string, messageId: string) => void;
  hasContextUsageMessageId: (sessionKey: string, messageId: string) => boolean;
  clearSession: (sessionKey: string) => void;
  clearAll: () => void;
};

const toTimestampMs = (timestamp: string | number): number | undefined => {
  if (typeof timestamp === "number") {
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }

  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const setDraftChannelValue = <T>(
  valuesBySession: Record<string, DraftChannelValueMap<T>>,
  sessionKey: string,
  channel: DraftChannel,
  value: T | undefined,
): void => {
  const current = valuesBySession[sessionKey] ?? {};
  const next = { ...current };
  if (value === undefined) {
    delete next[channel];
  } else {
    next[channel] = value;
  }

  if (Object.keys(next).length === 0) {
    delete valuesBySession[sessionKey];
    return;
  }
  valuesBySession[sessionKey] = next;
};

export const createSessionDraftBuffers = (): SessionDraftBuffers => {
  const rawBySession: Record<string, DraftChannelValueMap<string>> = {};
  const sourceBySession: Record<string, DraftChannelValueMap<DraftSource>> = {};
  const messageIdBySession: Record<string, DraftChannelValueMap<string>> = {};
  const flushTimeoutBySession: Record<string, ReturnType<typeof setTimeout> | undefined> = {};

  const clearFlushTimeout = (sessionKey: string): void => {
    const timeoutId = flushTimeoutBySession[sessionKey];
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      delete flushTimeoutBySession[sessionKey];
    }
  };

  const clearSession = (sessionKey: string): void => {
    clearFlushTimeout(sessionKey);
    delete rawBySession[sessionKey];
    delete sourceBySession[sessionKey];
    delete messageIdBySession[sessionKey];
  };

  return {
    readChannel: (sessionKey, channel) => ({
      raw: rawBySession[sessionKey]?.[channel] ?? "",
      ...(sourceBySession[sessionKey]?.[channel]
        ? { source: sourceBySession[sessionKey]?.[channel] }
        : {}),
      ...(messageIdBySession[sessionKey]?.[channel]
        ? { messageId: messageIdBySession[sessionKey]?.[channel] }
        : {}),
    }),
    writeChannel: (sessionKey, channel, draft) => {
      setDraftChannelValue(rawBySession, sessionKey, channel, draft.raw);
      setDraftChannelValue(sourceBySession, sessionKey, channel, draft.source);
      setDraftChannelValue(messageIdBySession, sessionKey, channel, draft.messageId);
    },
    clearChannel: (sessionKey, channel, nextDraft) => {
      clearFlushTimeout(sessionKey);
      setDraftChannelValue(rawBySession, sessionKey, channel, undefined);
      setDraftChannelValue(sourceBySession, sessionKey, channel, nextDraft?.source);
      setDraftChannelValue(messageIdBySession, sessionKey, channel, nextDraft?.messageId);
    },
    clearFlushTimeout,
    scheduleFlush: (sessionKey, flush, delayMs) => {
      clearFlushTimeout(sessionKey);
      flushTimeoutBySession[sessionKey] = setTimeout(() => {
        delete flushTimeoutBySession[sessionKey];
        flush();
      }, delayMs);
    },
    clearSession,
    clearAll: () => {
      for (const sessionKey of Object.keys(flushTimeoutBySession)) {
        clearFlushTimeout(sessionKey);
      }
      for (const sessionKey of Object.keys(rawBySession)) {
        delete rawBySession[sessionKey];
      }
      for (const sessionKey of Object.keys(sourceBySession)) {
        delete sourceBySession[sessionKey];
      }
      for (const sessionKey of Object.keys(messageIdBySession)) {
        delete messageIdBySession[sessionKey];
      }
    },
  };
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
        ...(timingBySession[sessionKey] ?? {}),
        activityStartedAtMs:
          typeof current === "number" ? Math.min(current, timestampMs) : timestampMs,
      };
    },
    recordTurnUserMessageTimestamp: (sessionKey, timestamp) => {
      const timestampMs = toTimestampMs(timestamp);
      if (timestampMs === undefined) {
        return timingBySession[sessionKey]?.userAnchorAtMs;
      }
      const current = timingBySession[sessionKey]?.userAnchorAtMs;
      const userAnchorAtMs =
        typeof current === "number" ? Math.min(current, timestampMs) : timestampMs;
      timingBySession[sessionKey] = {
        ...(timingBySession[sessionKey] ?? {}),
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
      return resolveAssistantTurnDurationMs({
        completedAtMs,
        ...(typeof activityStartedAtMs === "number" ? { activityStartedAtMs } : {}),
        ...(typeof userAnchorAtMs === "number" ? { userAnchorAtMs } : {}),
        ...(typeof previousAssistantCompletedAtMs === "number"
          ? { previousAssistantCompletedAtMs }
          : {}),
      });
    },
    clearTurnDuration: (sessionKey, completedTimestamp) => {
      const completedAtMs =
        completedTimestamp === undefined ? undefined : toTimestampMs(completedTimestamp);
      const nextTiming = { ...(timingBySession[sessionKey] ?? {}) };
      delete nextTiming.activityStartedAtMs;
      delete nextTiming.userAnchorAtMs;
      if (typeof completedAtMs === "number") {
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

export const createSessionTurnMetadata = (): SessionTurnMetadata => {
  const modelBySession: Record<string, AgentSessionState["selectedModel"]> = {};
  const contextUsageMessageIdBySession: Record<string, string> = {};

  const clearSession = (sessionKey: string): void => {
    delete modelBySession[sessionKey];
    delete contextUsageMessageIdBySession[sessionKey];
  };

  return {
    recordModel: (sessionKey, model) => {
      modelBySession[sessionKey] = model ?? null;
    },
    readModel: (sessionKey) => modelBySession[sessionKey],
    recordContextUsageMessageId: (sessionKey, messageId) => {
      contextUsageMessageIdBySession[sessionKey] = messageId;
    },
    hasContextUsageMessageId: (sessionKey, messageId) =>
      contextUsageMessageIdBySession[sessionKey] === messageId,
    clearSession,
    clearAll: () => {
      for (const sessionKey of Object.keys(modelBySession)) {
        delete modelBySession[sessionKey];
      }
      for (const sessionKey of Object.keys(contextUsageMessageIdBySession)) {
        delete contextUsageMessageIdBySession[sessionKey];
      }
    },
  };
};

export const clearSessionTransientState = (
  state: SessionTransientState,
  session: AgentSessionIdentity,
): void => {
  const sessionKey = agentSessionIdentityKey(session);
  state.draftBuffers.clearSession(sessionKey);
  state.assistantTurnTiming.clearSession(sessionKey);
  state.turnMetadata.clearSession(sessionKey);
};

export const clearSessionsTransientState = (
  state: SessionTransientState,
  sessions: readonly AgentSessionIdentity[],
): void => {
  for (const session of sessions) {
    clearSessionTransientState(state, session);
  }
};

export const clearAllSessionTransientState = (state: SessionTransientState): void => {
  state.draftBuffers.clearAll();
  state.assistantTurnTiming.clearAll();
  state.turnMetadata.clearAll();
};
