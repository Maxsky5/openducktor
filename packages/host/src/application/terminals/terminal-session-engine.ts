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
  createTerminalSessionLifecycle,
  terminalFailure,
  terminalOperationFailure,
} from "./terminal-session-lifecycle";
import {
  createTerminalSessionStream,
  isLiveTerminal,
  type TerminalAttachment,
  type TerminalSession,
  type TerminalSessionAttachInput,
} from "./terminal-session-stream";
import type { TerminalTitleSettlementScheduler } from "./terminal-title-settler";
import { createTerminalTitleTracker } from "./terminal-title-tracker";

export type { TerminalSessionAttachInput } from "./terminal-session-stream";

export const createTerminalSessionEngine = ({
  now,
  ptyPort,
  scheduleTitleSettlement,
}: {
  now: () => Date;
  ptyPort: TerminalPtyPort;
  scheduleTitleSettlement?: TerminalTitleSettlementScheduler;
}) => {
  const sessions = new Map<string, TerminalSession>();
  const stream = createTerminalSessionStream();
  const {
    applyStreamEvents,
    closeSession,
    closeSessions,
    getSession,
    handleExit,
    handleFailure,
    pruneExited,
  } = createTerminalSessionLifecycle({ now, sessions, stream });

  const publishTitle = (session: TerminalSession, title: string): void => {
    if (title === session.summary.label) return;
    session.summary.label = title;
    for (const attachment of session.attachments.values()) {
      applyStreamEvents(
        session,
        stream.publishSafely(session, attachment, {
          version: TERMINAL_PROTOCOL_VERSION,
          type: "title",
          terminalId: session.summary.terminalId,
          title,
        }),
      );
    }
  };

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
        let session: TerminalSession;
        const titleTracker = createTerminalTitleTracker(
          (title) => publishTitle(session, title),
          scheduleTitleSettlement,
        );
        session = {
          summary,
          titleTracker,
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
            onOutput: (data) => {
              session.titleTracker.consume(data);
              applyStreamEvents(session, stream.handleOutput(session, data));
            },
            onFailure: () => handleFailure(session),
            onExit: ({ exitCode, signal }) => handleExit(session, exitCode, signal),
          }),
        );
        if (handleResult._tag === "Left") {
          session.titleTracker.dispose();
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
          session.attachments.set(input.attachmentId, attachment);
          try {
            stream.publish(attachment, {
              version: TERMINAL_PROTOCOL_VERSION,
              type: "snapshot",
              terminalId: input.terminalId,
              earliestRetainedSequence: earliest,
              snapshotSequenceEnd: session.nextSequence,
              lifecycle: session.summary.lifecycle,
              title: session.summary.label,
              complete,
            });
            applyStreamEvents(session, stream.flushAttachment(session, attachment, true));
          } catch (cause) {
            if (previousAttachment) session.attachments.set(input.attachmentId, previousAttachment);
            else session.attachments.delete(input.attachmentId);
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
        const events = yield* stream
          .resumeOutputIfUnblocked(session)
          .pipe(
            Effect.mapError((cause) =>
              terminalFailure(
                "output_overflow",
                "ack",
                cause.message,
                session.summary.terminalId,
                cause,
              ),
            ),
          );
        applyStreamEvents(session, events);
      }),
    detach: (terminalId: string, attachmentId: string): Effect.Effect<void, TerminalServiceError> =>
      Effect.gen(function* () {
        const session = yield* Effect.try({
          try: () => getSession(terminalId, "detach"),
          catch: (cause) => terminalOperationFailure(cause, "detach"),
        });
        session.attachments.delete(attachmentId);
        const events = yield* stream
          .resumeOutputIfUnblocked(session)
          .pipe(
            Effect.mapError((cause) =>
              terminalFailure(
                "output_overflow",
                "detach",
                cause.message,
                session.summary.terminalId,
                cause,
              ),
            ),
          );
        applyStreamEvents(session, events);
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
    closeByTaskIds: (taskIds: readonly string[]): Effect.Effect<string[], TerminalServiceError> =>
      Effect.suspend(() => {
        const taskIdSet = new Set(taskIds);
        const targets = [...sessions.values()].filter((session) => {
          const taskId = session.summary.context.taskId;
          return taskId !== undefined && taskIdSet.has(taskId);
        });
        return closeSessions(targets, "close_by_task");
      }),
    dispose: (): Effect.Effect<void, TerminalServiceError> =>
      closeSessions([...sessions.values()], "dispose").pipe(Effect.asVoid),
  };
};
