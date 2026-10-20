import { Effect, Fiber } from "effect";
import {
  type HostOperationErrorAggregate,
  HostOperationError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type { RuntimeSessionTarget } from "../../ports/runtime-registry-port";
import { flushClaudeLiveContextUsageRefresh } from "./claude-agent-sdk-context-usage";
import { hasActiveClaudeBackgroundTools } from "./claude-agent-sdk-event-session";
import {
  ClaudeSessionError,
  runAllSteps,
  toSessionError,
} from "./claude-agent-sdk-session-lifecycle";
import {
  assertClaudeSessionTarget,
  claudeSessionMatchesTarget,
} from "./claude-agent-sdk-session-shape";
import { clearClaudeStreamToolInputTree } from "./claude-agent-sdk-tool-input-stream";
import type {
  ClaudeAgentSdkEventEmitter,
  ClaudeSession,
  ClaudeSessionStore,
} from "./claude-agent-sdk-types";
import { rejectPendingAdmissions } from "./claude-agent-sdk-user-message-admission";

export type CreateClaudeAgentSdkSessionStoreInput = {
  emit?: ClaudeAgentSdkEventEmitter;
  now?: () => string;
};

/** Own consumers until they finish, even after close removes the session. */
export const createClaudeAgentSdkSessionStore = ({
  emit,
  now = () => new Date().toISOString(),
}: CreateClaudeAgentSdkSessionStoreInput = {}): ClaudeSessionStore => {
  const sessions = new Map<string, ClaudeSession>();
  const closeListeners = new Set<(session: ClaudeSession) => void>();
  const states = new WeakMap<ClaudeSession, SessionState>();
  const activeConsumers = new Set<ClaudeSession>();
  const stateFor = (session: ClaudeSession): SessionState => {
    let state = states.get(session);
    if (!state) {
      state = { closed: false, finishAttempted: false };
      states.set(session, state);
    }
    return state;
  };
  const close = (session: ClaudeSession): void => {
    const state = stateFor(session);
    if (state.closed) {
      if (state.closeError) throw state.closeError;
      return;
    }
    state.closed = true;
    const failures: unknown[] = [];
    const attempt = (step: () => void): void => {
      try {
        step();
      } catch (cause) {
        failures.push(cause);
      }
    };
    session.activity = "stopped";
    session.activeSdkUserTurnCount = 0;
    session.pendingUserTurnCount = 0;
    attempt(() => clearClaudeStreamToolInputTree(session));
    for (const pending of session.pendingApprovals.values()) {
      attempt(() =>
        pending.resolve({
          behavior: "deny",
          message: "Claude session was stopped.",
          interrupt: true,
        }),
      );
    }
    attempt(() => rejectPendingAdmissions(session, new Error("Claude session was stopped.")));
    session.unreadSteeredUserMessages.clear();
    attempt(() => session.queue.close());
    attempt(() => session.abortController.abort());
    attempt(() => session.query.close());
    if (sessions.get(session.externalSessionId) === session) {
      sessions.delete(session.externalSessionId);
    }
    session.pendingApprovals.clear();
    session.pendingQuestions.clear();
    for (const listener of closeListeners) {
      attempt(() => listener(session));
    }
    if (failures.length > 0) {
      const failure = new ClaudeSessionError("claudeRuntime.closeSession", failures);
      state.closeError = failure;
      throw failure;
    }
  };
  const finish: ClaudeSessionStore["finish"] = (
    session,
    message,
    publish = emit,
    timestamp = now(),
  ): void => {
    const state = stateFor(session);
    const current = sessions.get(session.externalSessionId);
    if ((current && current !== session) || state.canFinish?.() === false) return;
    if (state.finishAttempted) return;
    // Publish can throw after delivery, so mark the attempt first.
    state.finishAttempted = true;
    publish?.(session, {
      type: "session_finished",
      externalSessionId: session.externalSessionId,
      timestamp,
      message,
    });
  };
  const settle: ClaudeSessionStore["settle"] = (session) =>
    Effect.suspend(() => {
      const { consumer } = stateFor(session);
      return runAllSteps([
        Effect.try({
          try: () => close(session),
          catch: (cause) => new ClaudeSessionError("claudeRuntime.closeSession", [cause]),
        }),
        consumer
          ? Fiber.join(consumer)
          : runAllSteps([
              Effect.tryPromise({
                try: () => session.query.return().then(() => {}),
                catch: (cause) => new ClaudeSessionError("claudeRuntime.returnQuery", [cause]),
              }),
              Effect.tryPromise({
                try: () => flushClaudeLiveContextUsageRefresh(session),
                catch: (cause) =>
                  new ClaudeSessionError("claudeRuntime.flushContextUsage", [cause]),
              }),
            ]),
      ]);
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.fail(toSessionError(cause, "claudeRuntime.settleSession")),
      ),
      Effect.uninterruptible,
      Effect.withSpan("claudeRuntime.settleSession"),
    );

  const stop = (session: ClaudeSession, message: string) =>
    Effect.suspend(() => {
      const wasAttached = sessions.get(session.externalSessionId) === session;
      return runAllSteps([
        settle(session),
        Effect.try({
          try: () => {
            if (wasAttached) finish(session, message);
          },
          catch: (cause) => new ClaudeSessionError("claudeRuntime.finishSession", [cause]),
        }),
      ]);
    }).pipe(
      Effect.catchCause((cause) => Effect.fail(toSessionError(cause, "claudeRuntime.stopSession"))),
    );

  const getForCleanup = (externalSessionId: string): ClaudeSession | undefined =>
    sessions.get(externalSessionId) ??
    [...activeConsumers].findLast((session) => session.externalSessionId === externalSessionId);

  return {
    sessions,
    close,
    finish,
    settle,
    ownConsumer: (session, fiber, canFinish) => {
      const state = stateFor(session);
      state.consumer = fiber;
      state.canFinish = canFinish;
      activeConsumers.add(session);
      fiber.addObserver(() => activeConsumers.delete(session));
    },
    get: (externalSessionId) => sessions.get(externalSessionId),
    getForCleanup,
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
      return Effect.succeed({
        supported: true,
        hasLiveSession: session
          ? claudeSessionMatchesTarget(session, input) &&
            (hasActiveClaudeWork(session) || hasActiveClaudeBackgroundTools(session))
          : false,
      });
    },
    stopSession: (input: RuntimeSessionTarget) =>
      Effect.gen(function* () {
        const session = yield* Effect.try({
          try: () => {
            const session = getForCleanup(input.externalSessionId);
            if (!session) {
              throw new HostValidationError({
                field: "externalSessionId",
                message: `Unknown Claude session '${input.externalSessionId}'.`,
                details: { externalSessionId: input.externalSessionId },
              });
            }
            assertClaudeSessionTarget(session, input, "stop");
            return session;
          },
          catch: (cause) => {
            if (cause instanceof HostValidationError || cause instanceof HostOperationError) {
              return cause;
            }
            return toHostOperationError(cause, "claudeRuntime.stopSession", {
              externalSessionId: input.externalSessionId,
            });
          },
        });
        yield* stop(session, "Session stopped");
      }).pipe(Effect.uninterruptible),
    stopSessionsForRuntime: (runtimeId) =>
      Effect.suspend(() => {
        const targets = [...new Set([...sessions.values(), ...activeConsumers])].filter(
          (session) => session.runtimeId === runtimeId,
        );
        return Effect.forEach(targets, (session) => Effect.exit(stop(session, "Runtime stopped")), {
          concurrency: "unbounded",
        }).pipe(Effect.flatMap((exits) => runAllSteps(exits)));
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.fail(toSessionError(cause, "claudeRuntime.stopSessionsForRuntime")),
        ),
        Effect.uninterruptible,
      ),
  };
};

export const hasActiveClaudeWork = (session: ClaudeSession): boolean =>
  session.activity === "running" ||
  session.sdkState === "running" ||
  session.sdkState === "requires_action" ||
  session.activeSdkUserTurnCount > 0 ||
  session.pendingUserTurnCount > 0 ||
  session.pendingApprovals.size > 0 ||
  session.pendingQuestions.size > 0;

export const isClaudeSessionStopped = (session: ClaudeSession): boolean =>
  session.activity === "stopped";

type SessionState = {
  consumer?: Fiber.Fiber<void, HostOperationErrorAggregate>;
  canFinish?: () => boolean;
  closed: boolean;
  closeError?: ClaudeSessionError;
  finishAttempted: boolean;
};
