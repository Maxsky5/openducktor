import {
  type TerminalContext,
  type TerminalListFilter,
  type TerminalSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import type { TerminalGrid, TerminalPtyPort } from "../../ports/terminal-pty-port";
import {
  type TerminalTaskScope,
  type TerminalWorkspaceSessionScope,
  terminalContextKey,
  terminalContextMatchesTaskScope,
  terminalContextMatchesWorkspaceSession,
} from "./terminal-context";
import { TERMINAL_LIMITS } from "./terminal-limits";
import { formatTerminalPathInput, TerminalPathInputError } from "./terminal-path-input";
import { TerminalServiceError } from "./terminal-service-error";
import {
  copyTerminalSummary,
  isCommandRunning,
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
import { createTerminalSessionProducer } from "./terminal-session-producer";
import { createTerminalActivity } from "./terminal-activity";

export type { TerminalSessionAttachInput } from "./terminal-session-output";

export type TerminalWorkspaceActivity = {
  activeTerminalIds: string[];
  unknownTerminalIds: string[];
};

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
  const activity = createTerminalActivity(sessions);
  const lifecycle = createTerminalSessionLifecycle({ now, sessions, activity });
  const { applyStreamEvents, closeSession, closeSessions, getSession, pruneExited } = lifecycle;
  const producer = createTerminalSessionProducer({
    sessions,
    ptyPort,
    lifecycle,
    activity,
    scheduleTitleSettlement,
  });

  return {
    observeActivity: activity.observe,
    countLive: (): number => {
      pruneExited();
      return [...sessions.values()].filter(
        (session) => isLiveTerminal(session) && session.summary.lifecycle !== "starting",
      ).length;
    },
    getContext: (terminalId: string): TerminalContext | null => {
      pruneExited();
      return sessions.get(terminalId)?.summary.context ?? null;
    },
    countLiveForContext: (context: TerminalContext): number => {
      pruneExited();
      return [...sessions.values()].filter(
        (session) =>
          isLiveTerminal(session) &&
          session.summary.lifecycle !== "starting" &&
          terminalContextKey(session.summary.context) === terminalContextKey(context),
      ).length;
    },
    inspectWorkspaceActivity: (
      repoPath: string,
    ): Effect.Effect<TerminalWorkspaceActivity, TerminalServiceError> =>
      Effect.gen(function* () {
        pruneExited();
        const normalizedRepoPath = normalizePathForComparison(repoPath);
        const activeTerminalIds: string[] = [];
        const unknownTerminalIds: string[] = [];
        for (const session of sessions.values()) {
          const context = session.summary.context;
          if (!isLiveTerminal(session) || !("repoPath" in context)) {
            continue;
          }
          if (normalizePathForComparison(context.repoPath) !== normalizedRepoPath) {
            continue;
          }
          if (isCommandRunning(session)) {
            activeTerminalIds.push(session.summary.terminalId);
            continue;
          }
          const handle = session.resources.handle;
          if (!handle) {
            unknownTerminalIds.push(session.summary.terminalId);
            continue;
          }
          const hasChildProcesses = yield* handle
            .hasChildProcesses()
            .pipe(Effect.mapError((cause) => terminalOperationFailure(cause, "list")));
          if (hasChildProcesses) {
            activeTerminalIds.push(session.summary.terminalId);
            continue;
          }
          // A shell builtin runs with no child process. Without shell integration
          // the engine cannot prove the shell is idle, so report unknown.
          unknownTerminalIds.push(session.summary.terminalId);
        }
        return { activeTerminalIds, unknownTerminalIds };
      }),
    ...producer,
    list: (filter: TerminalListFilter): TerminalSummary[] => {
      pruneExited();
      return [...sessions.values()].flatMap((session) => {
        const matches =
          filter.kind === "all" ||
          (filter.kind === "unassociated" && !("repoPath" in session.summary.context)) ||
          (filter.kind === "task" &&
            "taskId" in session.summary.context &&
            terminalContextKey(session.summary.context) ===
              terminalContextKey({ repoPath: filter.repoPath, taskId: filter.taskId })) ||
          (filter.kind === "workspace_session" &&
            terminalContextMatchesWorkspaceSession(session.summary.context, filter));
        return matches ? [copyTerminalSummary(session)] : [];
      });
    },
    preparePathInput: (
      terminalId: string,
      paths: readonly string[],
    ): Effect.Effect<string, TerminalServiceError> =>
      Effect.try({
        try: () => {
          const session = getSession(terminalId, "prepare_path_input");
          return formatTerminalPathInput(session.shell, paths);
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
      Effect.gen(function* () {
        const session = yield* Effect.try({
          try: () => getSession(input.terminalId, "attach"),
          catch: (cause) => terminalOperationFailure(cause, "attach"),
        });
        const needsRestore =
          (input.lastConsumedSequence ?? 0) < session.output.earliestRetainedSequence;
        const attachAfterDrain = Effect.tryPromise({
          try: async () => {
            if (needsRestore) {
              await session.screen.drained();
              getSession(input.terminalId, "attach");
            }
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
        });
        const handle = session.resources.handle;
        if (!needsRestore || !handle || !isLiveTerminal(session)) return yield* attachAfterDrain;
        if (!handle.supportsOutputPause) {
          return yield* Effect.fail(
            terminalFailure(
              "unsupported_runtime",
              "attach",
              "Terminal output cannot pause for a correct screen restore. Update OpenDucktor, then reconnect.",
              input.terminalId,
            ),
          );
        }
        return yield* Effect.acquireUseRelease(
          Effect.sync(() => session.output.beginSnapshotHold()),
          () =>
            session.output.pauseIfRequested(handle).pipe(
              Effect.mapError((cause) =>
                terminalFailure(
                  "protocol_error",
                  "attach",
                  "Terminal output could not pause for a correct screen restore. Retry the connection or close this tab.",
                  input.terminalId,
                  cause,
                ),
              ),
              Effect.andThen(attachAfterDrain),
            ),
          () => Effect.sync(() => applyStreamEvents(session, session.output.endSnapshotHold())),
        );
      }),
    write: (terminalId: string, data: Uint8Array): Effect.Effect<void, TerminalServiceError> =>
      Effect.gen(function* () {
        const session = yield* Effect.try({
          try: () => getSession(terminalId, "write"),
          catch: (cause) => terminalOperationFailure(cause, "write"),
        });
        if (data.byteLength === 0 || data.byteLength > TERMINAL_LIMITS.inputBytes)
          return yield* Effect.fail(
            terminalFailure(
              "invalid_input",
              "write",
              "Terminal input must contain between 1 byte and 64 KiB.",
              terminalId,
            ),
          );
        // Read the process in lane order: a command terminal replaces its process in this lane.
        return yield* session.operations.run(
          Effect.suspend(() => {
            const handle = session.resources.handle;
            if (!handle || !isLiveTerminal(session))
              return Effect.fail(
                terminalFailure(
                  "terminal_not_found",
                  "write",
                  `Terminal is not running: ${terminalId}`,
                  terminalId,
                ),
              );
            return handle
              .write(data)
              .pipe(
                Effect.mapError((cause) =>
                  terminalFailure("invalid_input", "write", cause.message, terminalId, cause),
                ),
              );
          }),
        );
      }),
    resize: (terminalId: string, grid: TerminalGrid): Effect.Effect<void, TerminalServiceError> =>
      Effect.gen(function* () {
        const session = yield* Effect.try({
          try: () => getSession(terminalId, "resize"),
          catch: (cause) => terminalOperationFailure(cause, "resize"),
        });
        // A command terminal has no process for a short time between its command and its shell.
        if (session.summary.lifecycle === "starting")
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
        yield* session.operations.run(
          Effect.suspend(() =>
            (session.resources.handle ? session.resources.handle.resize(grid) : Effect.void).pipe(
              Effect.mapError((cause) =>
                terminalFailure("invalid_grid", "resize", cause.message, terminalId, cause),
              ),
              Effect.tap(() =>
                Effect.sync(() => {
                  session.grid = grid;
                  session.screen.resize(grid);
                }),
              ),
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
    readOutputTail: (
      terminalId: string,
      lineCount: number,
    ): Effect.Effect<readonly string[], TerminalServiceError> =>
      Effect.try({
        try: () => getSession(terminalId, "read_output_tail").screen.outputTail(lineCount),
        catch: (cause) => terminalOperationFailure(cause, "read_output_tail"),
      }),
    closeByTaskScope: (scope: TerminalTaskScope): Effect.Effect<string[], TerminalServiceError> =>
      Effect.suspend(() => {
        const targets = [...sessions.values()].filter((session) =>
          terminalContextMatchesTaskScope(session.summary.context, scope),
        );
        return closeSessions(targets, "close_by_task");
      }),
    closeByWorkspaceSession: (
      scope: TerminalWorkspaceSessionScope,
    ): Effect.Effect<string[], TerminalServiceError> =>
      Effect.suspend(() => {
        const targets = [...sessions.values()].filter((session) =>
          terminalContextMatchesWorkspaceSession(session.summary.context, scope),
        );
        return closeSessions(targets, "close_by_workspace_session");
      }),
    dispose: (): Effect.Effect<void, TerminalServiceError> =>
      closeSessions([...sessions.values()], "dispose").pipe(Effect.asVoid),
  };
};
