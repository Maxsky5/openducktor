import { Effect, Fiber } from "effect";
import {
  type HostOperationErrorAggregate,
  HostOperationError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type { RuntimeSessionTarget } from "../../ports/runtime-registry-port";
import { flushClaudeLiveContextUsageRefresh } from "./claude-agent-sdk-context-usage";
import { clearClaudeNativeActivity } from "./claude-agent-sdk-activity";
import type { ClaudeEventSession } from "./claude-agent-sdk-event-session";
import { hasActiveClaudeBackgroundTools } from "./claude-agent-sdk-event-session";
import { childSessions } from "./claude-agent-sdk-session-children";
import {
  beginClaudeNativeProcessClose,
  isClaudeNativeProcessClosed,
  waitForClaudeNativeProcessExit,
} from "./claude-agent-sdk-native-process";
import {
  beginClaudeSessionClose,
  confirmClaudeSessionClosed,
  isClaudeSessionClosed,
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
  // Keep the latest identity after close without retaining the query.
  const latest = new Map<string, WeakRef<ClaudeSession>>();
  const closeListeners = new Set<(session: ClaudeSession) => void>();
  const states = new WeakMap<ClaudeSession, SessionState>();
  const activeConsumers = new Set<ClaudeSession>();
  const closingSessions = new Set<ClaudeSession>();
  const stateFor = (session: ClaudeSession): SessionState => {
    let state = states.get(session);
    if (!state) {
      state = { closed: false, finishAttempted: false };
      states.set(session, state);
    }
    return state;
  };
  const markClosed = (session: ClaudeSession): void => {
    const state = stateFor(session);
    if (state.closed) return;
    state.closed = true;
    confirmClaudeSessionClosed(session);
    session.activity = "stopped";
    session.activeSdkUserTurnCount = 0;
    session.pendingUserTurnCount = 0;
    delete session.statusUnavailableReason;
    clearClaudeNativeActivity(session);
    if (sessions.get(session.externalSessionId) === session) {
      sessions.delete(session.externalSessionId);
    }
    closingSessions.delete(session);
    const failures: unknown[] = [];
    for (const listener of closeListeners) {
      try {
        listener(session);
      } catch (cause) {
        failures.push(cause);
      }
    }
    if (failures.length > 0) throw new ClaudeSessionError("claudeRuntime.retireSession", failures);
  };
  const reportUnavailable = (session: ClaudeSession, failure: ClaudeSessionError): void => {
    if (stateFor(session).closed) return;
    const message = failure.message;
    session.statusUnavailableReason = message;
    emit?.(session, {
      type: "session_context_error",
      externalSessionId: session.externalSessionId,
      timestamp: now(),
      message,
      statusUnavailable: true,
    });
  };
  const close = (session: ClaudeSession): void => {
    const state = stateFor(session);
    if (!state.closed && state.closeRequested && isClaudeNativeProcessClosed(session)) {
      delete state.closeError;
      markClosed(session);
    }
    if (state.closed) {
      if (state.closeError) throw state.closeError;
      return;
    }
    if (state.closeRequested) {
      if (!state.closeError) return;
      // Explicit cleanup can retry a close that did not terminate the native process.
      delete state.closeError;
    }
    state.closeRequested = true;
    closingSessions.add(session);
    beginClaudeSessionClose(session);
    beginClaudeNativeProcessClose(session);
    const failures: unknown[] = [];
    const attempt = (step: () => void): void => {
      try {
        step();
      } catch (cause) {
        failures.push(cause);
      }
    };
    attempt(() => clearClaudeStreamToolInputTree(session));
    const cancelInput = (target: ClaudeEventSession): void => {
      for (const pending of target.pendingApprovals?.values() ?? []) {
        attempt(() =>
          pending.resolve({
            behavior: "deny",
            message: "Claude session was stopped.",
            interrupt: true,
          }),
        );
      }
      for (const pending of target.pendingQuestions?.values() ?? [])
        attempt(() => pending.resolve([]));
      target.pendingApprovals?.clear();
      target.pendingQuestions?.clear();
      for (const child of childSessions(target)) cancelInput(child);
    };
    cancelInput(session);
    attempt(() => rejectPendingAdmissions(session, new Error("Claude session was stopped.")));
    session.unreadSteeredUserMessages.clear();
    attempt(() => session.queue.close());
    attempt(() => session.abortController.abort());
    attempt(() => session.query.close());
    session.pendingApprovals.clear();
    session.pendingQuestions.clear();
    if (isClaudeNativeProcessClosed(session)) attempt(() => markClosed(session));
    if (failures.length > 0) {
      if (!state.closed)
        failures.push(
          new Error(
            "Claude session termination is unconfirmed. Inspect the Claude process, then retry Stop or restart the runtime.",
          ),
        );
      const failure = new ClaudeSessionError("claudeRuntime.closeSession", failures);
      state.closeError = failure;
      attempt(() => reportUnavailable(session, failure));
      throw failure;
    }
  };
  const confirmClosed: ClaudeSessionStore["confirmClosed"] = (session) =>
    Effect.tryPromise({
      try: async () => {
        await waitForClaudeNativeProcessExit(session);
        markClosed(session);
      },
      catch: (cause) => new ClaudeSessionError("claudeRuntime.confirmTermination", [cause]),
    }).pipe(
      Effect.tapError((failure) =>
        Effect.try({
          try: () => reportUnavailable(session, failure),
          catch: (cause) => new ClaudeSessionError("claudeRuntime.publishUnavailable", [cause]),
        }),
      ),
    );
  const finish: ClaudeSessionStore["finish"] = (
    session,
    message,
    publish = emit,
    timestamp = now(),
  ): void => {
    const state = stateFor(session);
    const current = sessions.get(session.externalSessionId);
    if (
      !state.closed ||
      state.replaced ||
      (current && current !== session) ||
      state.canFinish?.() === false
    )
      return;
    if (state.finishAttempted) return;
    // Publish can throw after delivery, so mark the attempt first.
    state.finishAttempted = true;
    publish?.(session, {
      type: "session_finished",
      externalSessionId: session.externalSessionId,
      timestamp,
      message: state.finishMessage ?? message,
    });
  };
  const settle: ClaudeSessionStore["settle"] = (session) =>
    Effect.suspend(() => {
      const { consumer } = stateFor(session);
      return Effect.gen(function* () {
        const closing = yield* Effect.exit(
          Effect.try({
            try: () => close(session),
            catch: (cause) => new ClaudeSessionError("claudeRuntime.closeSession", [cause]),
          }),
        );
        // A failed close can leave the consumer waiting forever. Keep ownership for cleanup.
        if (closing._tag === "Failure" && !isClaudeSessionClosed(session)) return yield* closing;
        yield* confirmClosed(session);
        yield* runAllSteps([
          closing,
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
      });
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
      stateFor(session).finishMessage = message;
      return Effect.gen(function* () {
        const settled = yield* Effect.exit(settle(session));
        yield* runAllSteps([
          settled,
          Effect.try({
            try: () => {
              if (wasAttached && isClaudeSessionClosed(session)) finish(session, message);
            },
            catch: (cause) => new ClaudeSessionError("claudeRuntime.finishSession", [cause]),
          }),
        ]);
      });
    }).pipe(
      Effect.catchCause((cause) => Effect.fail(toSessionError(cause, "claudeRuntime.stopSession"))),
    );

  const getForCleanup = (externalSessionId: string): ClaudeSession | undefined =>
    sessions.get(externalSessionId) ??
    [...closingSessions, ...activeConsumers].findLast(
      (session) => session.externalSessionId === externalSessionId,
    );

  return {
    sessions,
    close,
    confirmClosed,
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
    isLatest: (session) => latest.get(session.externalSessionId)?.deref() === session,
    getForCleanup,
    set: (session) => {
      const previous = sessions.get(session.externalSessionId);
      if (previous && previous !== session) stateFor(previous).replaced = true;
      stateFor(session).replaced = false;
      latest.set(session.externalSessionId, new WeakRef(session));
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
        const targets = [
          ...new Set([...sessions.values(), ...closingSessions, ...activeConsumers]),
        ].filter((session) => session.runtimeId === runtimeId);
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
  closeRequested?: boolean;
  replaced?: boolean;
  closeError?: ClaudeSessionError;
  finishAttempted: boolean;
  finishMessage?: string;
};
