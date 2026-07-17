import type { SessionRef } from "@openducktor/core";
import { agentSessionRefsEqual } from "@openducktor/core";
import { Effect } from "effect";
import { errorMessage, HostOperationError, HostValidationError } from "../../effect/host-errors";
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
      Effect.try({
        try: () => {
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
      Effect.try({
        try: () => {
          for (const session of [...sessions.values()]) {
            if (session.runtimeId === runtimeId) {
              close(session);
              publishSessionFinished(session, "Runtime stopped");
            }
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
