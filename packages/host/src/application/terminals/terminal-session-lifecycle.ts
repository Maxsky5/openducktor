import { TERMINAL_PROTOCOL_VERSION } from "@openducktor/contracts";
import { Effect } from "effect";
import { TERMINAL_LIMITS } from "./terminal-limits";
import { TerminalServiceError } from "./terminal-service-error";
import {
  beginTerminalClose,
  disposeTerminalSession,
  exitTerminalSession,
  isLiveTerminal,
  markTerminalCloseFailed,
  markTerminalOverflowed,
  type TerminalSession,
} from "./terminal-session";
import type { TerminalOutputEvents } from "./terminal-session-output";

export type TerminalOperation = ConstructorParameters<typeof TerminalServiceError>[0]["operation"];

export const terminalFailure = (
  code: ConstructorParameters<typeof TerminalServiceError>[0]["code"],
  operation: TerminalOperation,
  message: string,
  terminalId?: string,
  cause?: unknown,
): TerminalServiceError =>
  new TerminalServiceError({
    code,
    operation,
    message,
    ...(terminalId ? { terminalId } : {}),
    ...(cause !== undefined ? { cause } : {}),
  });

export const terminalOperationFailure = (
  cause: unknown,
  operation: TerminalOperation,
): TerminalServiceError =>
  cause instanceof TerminalServiceError
    ? cause
    : terminalFailure(
        "protocol_error",
        operation,
        `Terminal ${operation} failed unexpectedly.`,
        undefined,
        cause,
      );

export const createTerminalSessionLifecycle = ({
  now,
  sessions,
}: {
  now: () => Date;
  sessions: Map<string, TerminalSession>;
}) => {
  const getSession = (terminalId: string, operation: TerminalOperation): TerminalSession => {
    const session = sessions.get(terminalId);
    if (!session) {
      throw terminalFailure(
        "terminal_not_found",
        operation,
        `Terminal not found: ${terminalId}`,
        terminalId,
      );
    }
    return session;
  };

  const emitLifecycle = (session: TerminalSession): void => {
    applyStreamEvents(
      session,
      session.output.publish({
        version: TERMINAL_PROTOCOL_VERSION,
        type: "lifecycle",
        terminalId: session.summary.terminalId,
        lifecycle: session.summary.lifecycle,
        ...(session.summary.exit
          ? {
              finalSequence: session.summary.exit.finalSequence,
              exitCode: session.summary.exit.exitCode,
              signal: session.summary.exit.signal,
            }
          : {}),
      }),
    );
  };

  const handleFailure = (session: TerminalSession): void => {
    markTerminalCloseFailed(session);
    emitLifecycle(session);
  };

  const pruneExited = (): void => {
    const cutoff = now().getTime() - TERMINAL_LIMITS.exitedRetentionMs;
    const exited = [...sessions.values()]
      .filter((session) => !isLiveTerminal(session))
      .sort((left, right) => left.summary.createdAt.localeCompare(right.summary.createdAt));
    const expired = exited.filter(
      (session) =>
        new Date(session.summary.exit?.exitedAt ?? session.summary.createdAt).getTime() < cutoff,
    );
    const overCapacity = exited.slice(
      0,
      Math.max(0, exited.length - TERMINAL_LIMITS.retainedExited),
    );
    for (const session of new Set([...expired, ...overCapacity])) {
      disposeTerminalSession(session);
      applyStreamEvents(
        session,
        session.output.publish({
          version: TERMINAL_PROTOCOL_VERSION,
          type: "terminal_forgotten",
          terminalId: session.summary.terminalId,
        }),
      );
      sessions.delete(session.summary.terminalId);
    }
  };

  const handleExit = (
    session: TerminalSession,
    exitCode: number | null,
    signal: string | null,
  ): void => {
    if (
      !exitTerminalSession(session, {
        exitCode,
        signal,
        exitedAt: now().toISOString(),
      })
    )
      return;
    emitLifecycle(session);
    pruneExited();
  };

  function terminateForOverflow(session: TerminalSession): void {
    if (!markTerminalOverflowed(session)) return;
    applyStreamEvents(
      session,
      session.output.publish({
        version: TERMINAL_PROTOCOL_VERSION,
        type: "output_overflow",
        terminalId: session.summary.terminalId,
      }),
    );
    const handle = session.resources.handle;
    if (!handle) return;
    beginTerminalClose(session);
    emitLifecycle(session);
    Effect.runFork(
      handle.terminate().pipe(
        Effect.tap(() => Effect.sync(() => handleExit(session, null, "output_overflow"))),
        Effect.tapError(() => Effect.sync(() => handleFailure(session))),
      ),
    );
  }

  function applyStreamEvents(session: TerminalSession, events: TerminalOutputEvents): void {
    for (const event of events) {
      if (event.type === "overflow") {
        terminateForOverflow(session);
      } else if (event.type === "attachments_empty" && session.resources.handle) {
        Effect.runFork(
          session.output.resumeIfUnblocked(session.resources.handle).pipe(
            Effect.tap((resumeEvents) =>
              Effect.sync(() => applyStreamEvents(session, resumeEvents)),
            ),
            Effect.tapError(() => Effect.sync(() => terminateForOverflow(session))),
          ),
        );
      } else if (event.type === "pause_requested" && session.resources.handle) {
        Effect.runFork(
          session.resources.handle
            .pauseOutput()
            .pipe(Effect.tapError(() => Effect.sync(() => terminateForOverflow(session)))),
        );
      }
    }
  }

  const closeSession = (session: TerminalSession, confirmTerminate: boolean) =>
    Effect.gen(function* () {
      const terminalId = session.summary.terminalId;
      const handle = session.resources.handle;
      if (isLiveTerminal(session) && !confirmTerminate && handle) {
        const inspection = yield* Effect.either(handle.hasChildProcesses());
        if (inspection._tag === "Left") {
          return yield* Effect.fail(
            terminalFailure(
              "close_failed",
              "close",
              `Failed to determine whether ${session.summary.label} has running commands.`,
              terminalId,
              inspection.left,
            ),
          );
        }
        if (inspection.right) {
          return yield* Effect.fail(
            terminalFailure(
              "confirmation_required",
              "close",
              `${session.summary.label} has a running command.`,
              terminalId,
            ),
          );
        }
      }
      if (handle) {
        beginTerminalClose(session);
        emitLifecycle(session);
        const result = yield* Effect.either(handle.terminate());
        if (result._tag === "Left") {
          handleFailure(session);
          return yield* Effect.fail(
            terminalFailure(
              "close_failed",
              "close",
              `Failed to terminate terminal ${terminalId}.`,
              terminalId,
              result.left,
            ),
          );
        }
      }
      applyStreamEvents(
        session,
        session.output.publish({
          version: TERMINAL_PROTOCOL_VERSION,
          type: "terminal_forgotten",
          terminalId,
        }),
      );
      disposeTerminalSession(session);
      sessions.delete(terminalId);
    });

  const closeSessions = (
    targets: readonly TerminalSession[],
    operation: "close_by_task" | "dispose",
  ): Effect.Effect<string[], TerminalServiceError> =>
    Effect.gen(function* () {
      const results = yield* Effect.forEach(
        targets,
        (session) =>
          Effect.either(closeSession(session, true)).pipe(
            Effect.map((result) => ({ terminalId: session.summary.terminalId, result })),
          ),
        { concurrency: TERMINAL_LIMITS.livePerHost },
      );
      const errors = results.flatMap(({ terminalId, result }) =>
        result._tag === "Left" ? [{ terminalId, message: result.left.message }] : [],
      );
      if (errors.length > 0) {
        const context = operation === "dispose" ? " during shutdown" : "";
        return yield* Effect.fail(
          new TerminalServiceError({
            code: "close_failed",
            operation,
            message: `Failed to terminate ${errors.length} terminal(s)${context}.`,
            details: { errors },
          }),
        );
      }
      return results.map(({ terminalId }) => terminalId);
    });

  return {
    applyStreamEvents,
    closeSession,
    closeSessions,
    getSession,
    handleExit,
    handleFailure,
    pruneExited,
  };
};
