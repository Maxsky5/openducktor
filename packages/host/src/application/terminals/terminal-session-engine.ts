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
import { formatTerminalPathInput, TerminalPathInputError } from "./terminal-path-input";
import { TerminalServiceError } from "./terminal-service-error";
import {
  activateTerminalSession,
  createTerminalSession,
  disposeTerminalSession,
  isLiveTerminal,
  type TerminalSession,
} from "./terminal-session";
import {
  createTerminalSessionLifecycle,
  terminalFailure,
  terminalOperationFailure,
} from "./terminal-session-lifecycle";
import {
  TerminalOutputStateError,
  type TerminalSessionAttachInput,
} from "./terminal-session-output";
import type { TerminalTitleSettlementScheduler } from "./terminal-title-settler";
import { createTerminalTitleTracker } from "./terminal-title-tracker";

export type { TerminalSessionAttachInput } from "./terminal-session-output";

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
  const {
    applyStreamEvents,
    closeSession,
    closeSessions,
    getSession,
    handleExit,
    handleFailure,
    pruneExited,
  } = createTerminalSessionLifecycle({ now, sessions });

  const publishTitle = (session: TerminalSession, title: string): void => {
    if (title === session.summary.label) return;
    session.summary.label = title;
    applyStreamEvents(
      session,
      session.output.publish({
        version: TERMINAL_PROTOCOL_VERSION,
        type: "title",
        terminalId: session.summary.terminalId,
        title,
      }),
    );
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
        session = createTerminalSession({
          summary,
          titleTracker,
          operations: yield* Effect.makeSemaphore(1),
          replayByteLimit: TERMINAL_LIMITS.replayBytes,
          shell: plan.shell,
        });
        sessions.set(summary.terminalId, session);
        const handleResult = yield* Effect.either(
          ptyPort.start(plan, {
            onOutput: (data) => {
              session.resources.consumeOutput(data);
              applyStreamEvents(session, session.output.accept(data, session.resources.handle));
            },
            onFailure: () => handleFailure(session),
            onExit: ({ exitCode, signal }) => handleExit(session, exitCode, signal),
          }),
        );
        if (handleResult._tag === "Left") {
          disposeTerminalSession(session);
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
        activateTerminalSession(session, handleResult.right);
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
    preparePathInput: (
      terminalId: string,
      paths: readonly string[],
    ): Effect.Effect<string, TerminalServiceError> =>
      Effect.try({
        try: () => {
          const session = getSession(terminalId, "prepare_path_input");
          return formatTerminalPathInput(session.resources.shell, paths);
        },
        catch: (cause) => {
          if (cause instanceof TerminalServiceError) return cause;
          if (cause instanceof TerminalPathInputError) {
            return terminalFailure(
              cause.code,
              "prepare_path_input",
              cause.message,
              terminalId,
              cause,
            );
          }
          return terminalOperationFailure(cause, "prepare_path_input");
        },
      }),
    attach: (input: TerminalSessionAttachInput): Effect.Effect<void, TerminalServiceError> =>
      Effect.try({
        try: () => {
          const session = getSession(input.terminalId, "attach");
          applyStreamEvents(
            session,
            session.output.attach(input, session.summary, session.resources.handle),
          );
        },
        catch: (cause) => {
          if (cause instanceof TerminalServiceError) return cause;
          if (cause instanceof TerminalOutputStateError) {
            return terminalFailure(
              "protocol_error",
              "attach",
              cause.message,
              input.terminalId,
              cause,
            );
          }
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
        const handle = session.resources.handle;
        if (!handle || !isLiveTerminal(session))
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
          handle
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
        const handle = session.resources.handle;
        if (!handle || !isLiveTerminal(session))
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
          handle
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
        yield* Effect.try({
          try: () => session.output.acknowledge(attachmentId, sequenceEnd),
          catch: (cause) => {
            if (!(cause instanceof TerminalOutputStateError)) {
              return terminalOperationFailure(cause, "ack");
            }
            return terminalFailure(
              cause.code === "attachment_not_found" ? "terminal_not_found" : "protocol_error",
              "ack",
              cause.message,
              terminalId,
              cause,
            );
          },
        });
        const events = yield* session.output
          .resumeIfUnblocked(session.resources.handle)
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
        session.output.detach(attachmentId);
        const events = yield* session.output
          .resumeIfUnblocked(session.resources.handle)
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
