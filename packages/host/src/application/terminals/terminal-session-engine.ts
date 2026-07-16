import {
  TERMINAL_PROTOCOL_VERSION,
  type TerminalListFilter,
  type TerminalSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type {
  TerminalGrid,
  TerminalPtyLaunchPlan,
  TerminalPtyPort,
} from "../../ports/terminal-pty-port";
import { TERMINAL_LIMITS } from "./terminal-limits";
import { TerminalServiceError } from "./terminal-service-error";
import {
  createTerminalSessionStream,
  isLiveTerminal,
  type TerminalAttachment,
  type TerminalSession,
  type TerminalSessionAttachInput,
} from "./terminal-session-stream";

type TerminalOperation = ConstructorParameters<typeof TerminalServiceError>[0]["operation"];

const terminalFailure = (
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

const terminalOperationFailure = (
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

export type { TerminalSessionAttachInput } from "./terminal-session-stream";

export const createTerminalSessionEngine = ({
  now,
  ptyPort,
}: {
  now: () => Date;
  ptyPort: TerminalPtyPort;
}) => {
  const sessions = new Map<string, TerminalSession>();

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
    for (const attachment of session.attachments.values()) {
      stream.publishSafely(session, attachment, {
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
      });
    }
  };

  const handleFailure = (session: TerminalSession): void => {
    session.summary.lifecycle = "close_failed";
    session.summary.attentionState = "close_failed";
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
      for (const attachment of session.attachments.values()) {
        stream.publishSafely(session, attachment, {
          version: TERMINAL_PROTOCOL_VERSION,
          type: "terminal_forgotten",
          terminalId: session.summary.terminalId,
        });
      }
      sessions.delete(session.summary.terminalId);
    }
  };

  const handleExit = (
    session: TerminalSession,
    exitCode: number | null,
    signal: string | null,
  ): void => {
    if (session.summary.lifecycle === "exited") return;
    session.handle = null;
    session.summary.lifecycle = "exited";
    if (!session.overflowed) session.summary.attentionState = "exited";
    session.summary.exit = {
      exitCode,
      signal,
      finalSequence: session.nextSequence,
      exitedAt: now().toISOString(),
    };
    emitLifecycle(session);
    pruneExited();
  };

  const stream = createTerminalSessionStream({
    emitLifecycle,
    handleExit,
    handleFailure,
    resumeFailure: (session, operation, cause) =>
      terminalFailure(
        "output_overflow",
        operation,
        cause.message,
        session.summary.terminalId,
        cause,
      ),
  });

  const closeSession = (session: TerminalSession, confirmTerminate: boolean) =>
    Effect.gen(function* () {
      const terminalId = session.summary.terminalId;
      if (isLiveTerminal(session) && !confirmTerminate && session.handle) {
        const inspection = yield* Effect.either(session.handle.hasChildProcesses());
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
        if (inspection.right)
          return yield* Effect.fail(
            terminalFailure(
              "confirmation_required",
              "close",
              `${session.summary.label} has a running command.`,
              terminalId,
            ),
          );
      }
      if (session.handle) {
        session.summary.lifecycle = "closing";
        emitLifecycle(session);
        const result = yield* Effect.either(session.handle.terminate());
        if (result._tag === "Left") {
          session.summary.lifecycle = "close_failed";
          session.summary.attentionState = "close_failed";
          emitLifecycle(session);
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
    countLive: (): number => {
      pruneExited();
      return [...sessions.values()].filter(isLiveTerminal).length;
    },
    countLiveForContext: (taskId: string | undefined): number => {
      pruneExited();
      return [...sessions.values()].filter(
        (session) => isLiveTerminal(session) && session.summary.context.taskId === taskId,
      ).length;
    },
    start: (
      summary: TerminalSummary,
      plan: TerminalPtyLaunchPlan,
    ): Effect.Effect<TerminalSummary, TerminalServiceError> =>
      Effect.gen(function* () {
        const session: TerminalSession = {
          summary,
          handle: null,
          replay: [],
          replayBytes: 0,
          nextSequence: 0,
          attachments: new Map(),
          paused: false,
          overflowed: false,
          operations: yield* Effect.makeSemaphore(1),
        };
        sessions.set(summary.terminalId, session);
        const handleResult = yield* Effect.either(
          ptyPort.start(plan, {
            onOutput: (data) => stream.handleOutput(session, data),
            onFailure: () => handleFailure(session),
            onExit: ({ exitCode, signal }) => handleExit(session, exitCode, signal),
          }),
        );
        if (handleResult._tag === "Left") {
          sessions.delete(summary.terminalId);
          return yield* Effect.fail(
            terminalFailure(
              handleResult.left.code === "unsupported_runtime"
                ? "unsupported_runtime"
                : "spawn_failed",
              "create",
              handleResult.left.message,
              summary.terminalId,
              handleResult.left,
            ),
          );
        }
        session.handle = handleResult.right;
        if (session.summary.lifecycle === "starting") session.summary.lifecycle = "running";
        return { ...session.summary, context: { ...session.summary.context } };
      }),
    list: (filter: TerminalListFilter): TerminalSummary[] => {
      pruneExited();
      return [...sessions.values()].flatMap((session) => {
        const matches =
          filter.kind === "all" ||
          (filter.kind === "unassociated" && session.summary.context.taskId === undefined) ||
          (filter.kind === "task" && session.summary.context.taskId === filter.taskId);
        return matches ? [{ ...session.summary, context: { ...session.summary.context } }] : [];
      });
    },
    setInitialWorkingDirAvailable: (terminalId: string, available: boolean): void => {
      getSession(terminalId, "list").summary.initialWorkingDirAvailable = available;
    },
    attach: (input: TerminalSessionAttachInput): Effect.Effect<void, TerminalServiceError> =>
      Effect.try({
        try: () => {
          const session = getSession(input.terminalId, "attach");
          const requested = input.lastConsumedSequence ?? 0;
          if (requested > session.nextSequence) {
            throw terminalFailure(
              "protocol_error",
              "attach",
              `Terminal replay position ${requested} is beyond the published sequence ${session.nextSequence}.`,
              input.terminalId,
            );
          }
          const earliest = session.replay[0]?.sequenceStart ?? session.nextSequence;
          const complete = requested >= earliest;
          const attachment: TerminalAttachment = {
            attachmentId: input.attachmentId,
            sink: input.sink,
            acknowledgedSequence: requested,
            deliveredSequence: requested,
            pendingBytes: 0,
          };
          const previousAttachment = session.attachments.get(input.attachmentId);
          const previousConnectionState = session.summary.connectionState;
          const previousAttentionState = session.summary.attentionState;
          session.attachments.set(input.attachmentId, attachment);
          session.summary.connectionState = complete ? "connected" : "incomplete_replay";
          try {
            stream.publish(attachment, {
              version: TERMINAL_PROTOCOL_VERSION,
              type: "snapshot",
              terminalId: input.terminalId,
              earliestRetainedSequence: earliest,
              snapshotSequenceEnd: session.nextSequence,
              lifecycle: session.summary.lifecycle,
              complete,
            });
            stream.flushAttachment(session, attachment, true);
          } catch (cause) {
            if (previousAttachment) session.attachments.set(input.attachmentId, previousAttachment);
            else session.attachments.delete(input.attachmentId);
            session.summary.connectionState = previousConnectionState;
            session.summary.attentionState = previousAttentionState;
            throw cause;
          }
        },
        catch: (cause) => {
          if (cause instanceof TerminalServiceError) return cause;
          const message = cause instanceof Error ? cause.message : String(cause);
          return terminalFailure("protocol_error", "attach", message, input.terminalId, cause);
        },
      }),
    write: (terminalId: string, data: Uint8Array): Effect.Effect<void, TerminalServiceError> =>
      Effect.gen(function* () {
        const session = yield* Effect.try({
          try: () => getSession(terminalId, "write"),
          catch: (cause) => terminalOperationFailure(cause, "write"),
        });
        if (!session.handle || !isLiveTerminal(session))
          return yield* Effect.fail(
            terminalFailure(
              "terminal_not_found",
              "write",
              `Terminal is not running: ${terminalId}`,
              terminalId,
            ),
          );
        if (data.byteLength === 0 || data.byteLength > TERMINAL_LIMITS.inputBytes)
          return yield* Effect.fail(
            terminalFailure(
              "invalid_input",
              "write",
              "Terminal input must contain between 1 byte and 64 KiB.",
              terminalId,
            ),
          );
        return yield* session.operations.withPermits(1)(
          session.handle
            .write(data)
            .pipe(
              Effect.mapError((cause) =>
                terminalFailure("invalid_input", "write", cause.message, terminalId, cause),
              ),
            ),
        );
      }),
    resize: (terminalId: string, grid: TerminalGrid): Effect.Effect<void, TerminalServiceError> =>
      Effect.gen(function* () {
        const session = yield* Effect.try({
          try: () => getSession(terminalId, "resize"),
          catch: (cause) => terminalOperationFailure(cause, "resize"),
        });
        if (!session.handle || !isLiveTerminal(session))
          return yield* Effect.fail(
            terminalFailure(
              "terminal_not_found",
              "resize",
              `Terminal is not running: ${terminalId}`,
              terminalId,
            ),
          );
        if (
          !Number.isInteger(grid.columns) ||
          !Number.isInteger(grid.rows) ||
          grid.columns < 1 ||
          grid.columns > TERMINAL_LIMITS.columns ||
          grid.rows < 1 ||
          grid.rows > TERMINAL_LIMITS.rows
        )
          return yield* Effect.fail(
            terminalFailure(
              "invalid_grid",
              "resize",
              "Terminal grid is outside the supported range.",
              terminalId,
            ),
          );
        return yield* session.operations.withPermits(1)(
          session.handle
            .resize(grid)
            .pipe(
              Effect.mapError((cause) =>
                terminalFailure("invalid_grid", "resize", cause.message, terminalId, cause),
              ),
            ),
        );
      }),
    acknowledge: (
      terminalId: string,
      attachmentId: string,
      sequenceEnd: number,
    ): Effect.Effect<void, TerminalServiceError> =>
      Effect.gen(function* () {
        const session = yield* Effect.try({
          try: () => getSession(terminalId, "ack"),
          catch: (cause) => terminalOperationFailure(cause, "ack"),
        });
        const attachment = session.attachments.get(attachmentId);
        if (!attachment)
          return yield* Effect.fail(
            terminalFailure(
              "terminal_not_found",
              "ack",
              `Terminal attachment not found: ${attachmentId}`,
              terminalId,
            ),
          );
        if (
          !Number.isInteger(sequenceEnd) ||
          sequenceEnd < attachment.acknowledgedSequence ||
          sequenceEnd > attachment.deliveredSequence
        )
          return yield* Effect.fail(
            terminalFailure(
              "protocol_error",
              "ack",
              "Terminal ACK is outside the delivered sequence range.",
              terminalId,
            ),
          );
        attachment.acknowledgedSequence = sequenceEnd;
        attachment.pendingBytes = attachment.deliveredSequence - sequenceEnd;
        yield* stream.resumeOutputIfUnblocked(session, "ack");
      }),
    detach: (terminalId: string, attachmentId: string): Effect.Effect<void, TerminalServiceError> =>
      Effect.gen(function* () {
        const session = yield* Effect.try({
          try: () => getSession(terminalId, "detach"),
          catch: (cause) => terminalOperationFailure(cause, "detach"),
        });
        session.attachments.delete(attachmentId);
        if (session.attachments.size === 0) session.summary.connectionState = "disconnected";
        yield* stream.resumeOutputIfUnblocked(session, "detach");
      }),
    close: (
      terminalId: string,
      confirmTerminate: boolean,
    ): Effect.Effect<void, TerminalServiceError> =>
      Effect.gen(function* () {
        const session = yield* Effect.try({
          try: () => getSession(terminalId, "close"),
          catch: (cause) => terminalOperationFailure(cause, "close"),
        });
        yield* closeSession(session, confirmTerminate);
      }),
    closeByTaskIds: (taskIds: readonly string[]): Effect.Effect<string[], TerminalServiceError> => {
      const taskIdSet = new Set(taskIds);
      const targets = [...sessions.values()].filter((session) => {
        const taskId = session.summary.context.taskId;
        return taskId !== undefined && taskIdSet.has(taskId);
      });
      return closeSessions(targets, "close_by_task");
    },
    dispose: (): Effect.Effect<void, TerminalServiceError> =>
      closeSessions([...sessions.values()], "dispose").pipe(Effect.asVoid),
  };
};
