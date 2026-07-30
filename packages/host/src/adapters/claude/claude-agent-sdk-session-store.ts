import type { SessionRef } from "@openducktor/core";
import { agentSessionRefsEqual } from "@openducktor/core";
import { Effect } from "effect";
import { errorMessage, HostOperationError, HostValidationError } from "../../effect/host-errors";
import { flushClaudeLiveContextUsageRefresh } from "./claude-agent-sdk-context-usage";
import { assertClaudeSessionRef } from "./claude-agent-sdk-session-shape";
import type {
  ClaudeAgentSdkEventEmitter,
  ClaudeSession,
  ClaudeSessionStore,
} from "./claude-agent-sdk-types";
import { claudeSessionRef } from "./claude-agent-sdk-utils";

export type CreateClaudeAgentSdkSessionStoreInput = {
  emit?: ClaudeAgentSdkEventEmitter;
  now?: () => string;
};

const hasActiveClaudeWork = (session: ClaudeSession): boolean =>
  session.activity === "running" ||
  session.sdkState === "running" ||
  session.sdkState === "requires_action" ||
  session.activeSdkUserTurnCount > 0 ||
  session.pendingUserTurnCount > 0 ||
  session.queuedSdkMessages.length > 0 ||
  (session.activeBackgroundSubagentTaskIds?.size ?? 0) > 0 ||
  session.pendingApprovals.size > 0 ||
  session.pendingQuestions.size > 0;

export const createClaudeAgentSdkSessionStore = ({
  emit,
  now = () => new Date().toISOString(),
}: CreateClaudeAgentSdkSessionStoreInput = {}): ClaudeSessionStore => {
  const sessions = new Map<string, ClaudeSession>();
  const closeListeners = new Set<(session: ClaudeSession) => void>();
  const rejectPendingApprovals = (session: ClaudeSession, message: string): void => {
    for (const pending of session.pendingApprovals.values()) {
      pending.resolve({
        behavior: "deny",
        message,
        interrupt: true,
      });
    }
  };
  const close = (session: ClaudeSession): void => {
    rejectPendingApprovals(session, "Claude session was stopped.");
    const queuedMessageIds = session.queuedSdkMessages.flatMap((message) =>
      message.uuid ? [message.uuid] : [],
    );
    if (queuedMessageIds.length > 0) {
      emit?.(session, {
        type: "transcript_retracted",
        externalSessionId: session.externalSessionId,
        timestamp: now(),
        messageIds: queuedMessageIds,
      });
    }
    session.activity = "stopped";
    session.activeSdkUserTurnCount = 0;
    session.pendingUserTurnCount = 0;
    session.queuedSdkMessages = [];
    session.queue.close();
    session.abortController.abort();
    session.query.close();
    sessions.delete(session.externalSessionId);
    session.pendingApprovals.clear();
    session.pendingQuestions.clear();
    for (const listener of closeListeners) {
      listener(session);
    }
  };
  const publishSessionFinished = (session: ClaudeSession, message: string): void => {
    emit?.(session, {
      type: "session_finished",
      externalSessionId: session.externalSessionId,
      timestamp: now(),
      message,
    });
  };

  return {
    sessions,
    close,
    get: (externalSessionId) => sessions.get(externalSessionId),
    set: (session) => {
      sessions.set(session.externalSessionId, session);
    },
    subscribeClose: (listener) => {
      closeListeners.add(listener);
      return () => {
        closeListeners.delete(listener);
      };
    },
    values: () => sessions.values(),
    probeSessionStatus: (input) => {
      const session = sessions.get(input.externalSessionId);
      const matchesRef = session ? agentSessionRefsEqual(claudeSessionRef(session), input) : false;
      return Effect.succeed({
        supported: true,
        hasLiveSession: session ? matchesRef && hasActiveClaudeWork(session) : false,
      });
    },
    stopSession: (input: SessionRef) =>
      Effect.tryPromise({
        try: async () => {
          const session = sessions.get(input.externalSessionId);
          if (!session) {
            throw new HostValidationError({
              field: "externalSessionId",
              message: `Unknown Claude session '${input.externalSessionId}'.`,
              details: { externalSessionId: input.externalSessionId },
            });
          }
          assertClaudeSessionRef(session, input, "stop");
          close(session);
          await flushClaudeLiveContextUsageRefresh(session);
          publishSessionFinished(session, "Session stopped");
        },
        catch: (cause) => {
          if (cause instanceof HostValidationError) {
            return cause;
          }
          if (cause instanceof HostOperationError) {
            return cause;
          }
          return new HostOperationError({
            operation: "claudeRuntime.stopSession",
            message: errorMessage(cause),
            cause,
            details: { externalSessionId: input.externalSessionId },
          });
        },
      }),
    stopSessionsForRuntime: (runtimeId) =>
      Effect.tryPromise({
        try: async () => {
          const stoppedSessions = [...sessions.values()].filter(
            (session) => session.runtimeId === runtimeId,
          );
          for (const session of stoppedSessions) {
            close(session);
          }
          await Promise.all(stoppedSessions.map(flushClaudeLiveContextUsageRefresh));
          for (const session of stoppedSessions) {
            publishSessionFinished(session, "Runtime stopped");
          }
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "claudeRuntime.stopSessionsForRuntime",
            message: errorMessage(cause),
            cause,
            details: { runtimeId },
          }),
      }),
  };
};
