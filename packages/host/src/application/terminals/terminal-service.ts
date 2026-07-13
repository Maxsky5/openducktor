import {
  TERMINAL_PROTOCOL_VERSION,
  type TerminalCloseRequest,
  type TerminalCreateRequest,
  type TerminalCreateResponse,
  type TerminalListFilter,
  type TerminalListResponse,
  type TerminalSummary,
  terminalCloseRequestSchema,
  terminalCreateRequestSchema,
  terminalListFilterSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { FilesystemPort } from "../../ports/filesystem-port";
import type { TerminalGrid, TerminalPtyPort } from "../../ports/terminal-pty-port";
import {
  createTerminalLaunchPolicy,
  type TerminalLaunchEnvironmentPort,
} from "./terminal-launch-policy";
import { TERMINAL_LIMITS } from "./terminal-limits";
import { TerminalServiceError } from "./terminal-service-error";
import {
  createTerminalSessionEngine,
  isLiveTerminal,
  type TerminalAttachment,
  type TerminalSession,
  terminalFailure,
  terminalOperationFailure,
} from "./terminal-session-engine";

const DEFAULT_GRID: TerminalGrid = { columns: 80, rows: 24 };

export type TerminalAttachInput = {
  terminalId: string;
  attachmentId: string;
  lastConsumedSequence: number | null;
  sink: TerminalAttachment["sink"];
};

export type TerminalCloseByTaskResult = { closedTerminalIds: string[] };

export type TerminalService = {
  readonly hostInstanceId: string;
  create(input: TerminalCreateRequest): Effect.Effect<TerminalCreateResponse, TerminalServiceError>;
  list(filter: TerminalListFilter): Effect.Effect<TerminalListResponse, TerminalServiceError>;
  attach(input: TerminalAttachInput): Effect.Effect<void, TerminalServiceError>;
  write(terminalId: string, data: Uint8Array): Effect.Effect<void, TerminalServiceError>;
  resize(terminalId: string, grid: TerminalGrid): Effect.Effect<void, TerminalServiceError>;
  acknowledge(
    terminalId: string,
    attachmentId: string,
    sequenceEnd: number,
  ): Effect.Effect<void, TerminalServiceError>;
  detach(terminalId: string, attachmentId: string): Effect.Effect<void, TerminalServiceError>;
  close(input: TerminalCloseRequest): Effect.Effect<void, TerminalServiceError>;
  closeByTaskIds(
    taskIds: readonly string[],
  ): Effect.Effect<TerminalCloseByTaskResult, TerminalServiceError>;
  dispose(): Effect.Effect<void, TerminalServiceError>;
};

type CreateTerminalServiceInput = {
  filesystem: FilesystemPort;
  ptyPort: TerminalPtyPort;
  resolveLaunchEnvironment: TerminalLaunchEnvironmentPort;
  now?: () => Date;
  idFactory?: () => string;
  hostInstanceIdFactory?: () => string;
};

export const createTerminalService = ({
  filesystem,
  ptyPort,
  resolveLaunchEnvironment,
  now = () => new Date(),
  idFactory = () => globalThis.crypto.randomUUID(),
  hostInstanceIdFactory = () => globalThis.crypto.randomUUID(),
}: CreateTerminalServiceInput): Effect.Effect<TerminalService> =>
  Effect.gen(function* () {
    const hostInstanceId = hostInstanceIdFactory();
    const engine = createTerminalSessionEngine({ now });
    const {
      sessions,
      getSession,
      publish,
      pruneExited,
      flushAttachment,
      handleOutput,
      handleExit,
      handleFailure,
      closeSession,
    } = engine;
    const launch = createTerminalLaunchPolicy({
      filesystem,
      resolveEnvironment: resolveLaunchEnvironment,
    });
    let accepting = true;

    const resumeOutputIfUnblocked = (
      session: TerminalSession,
      operation: "ack" | "detach",
    ): Effect.Effect<void, TerminalServiceError> =>
      Effect.gen(function* () {
        if (
          !session.paused ||
          ![...session.attachments.values()].every(
            (candidate) => candidate.pendingBytes <= TERMINAL_LIMITS.resumeOutputBytes,
          )
        ) {
          return;
        }
        if (session.handle) {
          yield* session.handle
            .resumeOutput()
            .pipe(
              Effect.mapError((cause) =>
                terminalFailure(
                  "output_overflow",
                  operation,
                  cause.message,
                  session.summary.terminalId,
                  cause,
                ),
              ),
            );
        }
        session.paused = false;
        for (const candidate of session.attachments.values())
          flushAttachment(session, candidate, false);
      });

    const service: TerminalService = {
      hostInstanceId,
      create: (rawInput) =>
        Effect.gen(function* () {
          if (!accepting) {
            return yield* Effect.fail(
              terminalFailure("close_failed", "create", "Terminal service is shutting down."),
            );
          }
          const input = terminalCreateRequestSchema.parse(rawInput);
          pruneExited();
          const liveSessions = [...sessions.values()].filter(isLiveTerminal);
          if (liveSessions.length >= TERMINAL_LIMITS.livePerHost) {
            return yield* Effect.fail(
              terminalFailure(
                "host_terminal_limit",
                "create",
                "The host terminal limit has been reached.",
              ),
            );
          }
          const sameContext = liveSessions.filter(
            (session) => session.summary.context.taskId === input.context.taskId,
          );
          const contextLimit = input.context.taskId
            ? TERMINAL_LIMITS.livePerTask
            : TERMINAL_LIMITS.liveUnassociated;
          if (sameContext.length >= contextLimit) {
            return yield* Effect.fail(
              terminalFailure(
                "context_terminal_limit",
                "create",
                "The terminal limit for this context has been reached.",
              ),
            );
          }
          const plan = yield* launch(input, DEFAULT_GRID);
          const terminalId = idFactory();
          const usedLabels = new Set(
            [...sessions.values()]
              .filter((session) => session.summary.context.taskId === input.context.taskId)
              .map((session) => session.summary.label),
          );
          let labelNumber = 1;
          while (usedLabels.has(`Shell ${labelNumber}`)) labelNumber += 1;
          const summary: TerminalSummary = {
            terminalId,
            hostInstanceId,
            label: `Shell ${labelNumber}`,
            context: input.context,
            initialWorkingDir: plan.cwd,
            initialWorkingDirAvailable: true,
            createdAt: now().toISOString(),
            lifecycle: "starting",
            connectionState: "disconnected",
            attentionState: "none",
            exit: null,
          };
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
          sessions.set(terminalId, session);
          const handleResult = yield* Effect.either(
            ptyPort.start(plan, {
              onOutput: (data) => handleOutput(session, data),
              onFailure: () => handleFailure(session),
              onExit: ({ exitCode, signal }) => handleExit(session, exitCode, signal),
            }),
          );
          if (handleResult._tag === "Left") {
            sessions.delete(terminalId);
            return yield* Effect.fail(
              terminalFailure(
                handleResult.left.code === "unsupported_runtime"
                  ? "unsupported_runtime"
                  : "spawn_failed",
                "create",
                handleResult.left.message,
                terminalId,
                handleResult.left,
              ),
            );
          }
          session.handle = handleResult.right;
          if (session.summary.lifecycle === "starting") session.summary.lifecycle = "running";
          return { ref: { terminalId }, summary: { ...summary } };
        }),
      list: (rawFilter) =>
        Effect.gen(function* () {
          const filter = terminalListFilterSchema.parse(rawFilter);
          pruneExited();
          const matching = [...sessions.values()].filter((session) => {
            if (filter.kind === "all") return true;
            if (filter.kind === "unassociated") return session.summary.context.taskId === undefined;
            return session.summary.context.taskId === filter.taskId;
          });
          const terminals: TerminalSummary[] = [];
          for (const session of matching) {
            const directory = yield* Effect.either(
              filesystem.stat(session.summary.initialWorkingDir),
            );
            session.summary.initialWorkingDirAvailable =
              directory._tag === "Right" && directory.right.isDirectory;
            terminals.push({ ...session.summary, context: { ...session.summary.context } });
          }
          return { hostInstanceId, terminals };
        }),
      attach: (input) =>
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
              publish(attachment, {
                version: TERMINAL_PROTOCOL_VERSION,
                type: "snapshot",
                terminalId: input.terminalId,
                earliestRetainedSequence: earliest,
                snapshotSequenceEnd: session.nextSequence,
                lifecycle: session.summary.lifecycle,
                complete,
              });
              flushAttachment(session, attachment, true);
            } catch (cause) {
              if (previousAttachment) {
                session.attachments.set(input.attachmentId, previousAttachment);
              } else {
                session.attachments.delete(input.attachmentId);
              }
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
      write: (terminalId, data) =>
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
      resize: (terminalId, grid) =>
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
      acknowledge: (terminalId, attachmentId, sequenceEnd) =>
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
          yield* resumeOutputIfUnblocked(session, "ack");
        }),
      detach: (terminalId, attachmentId) =>
        Effect.gen(function* () {
          const session = yield* Effect.try({
            try: () => getSession(terminalId, "detach"),
            catch: (cause) => terminalOperationFailure(cause, "detach"),
          });
          session.attachments.delete(attachmentId);
          if (session.attachments.size === 0) session.summary.connectionState = "disconnected";
          yield* resumeOutputIfUnblocked(session, "detach");
        }),
      close: (rawInput) =>
        Effect.gen(function* () {
          const input = terminalCloseRequestSchema.parse(rawInput);
          const session = yield* Effect.try({
            try: () => getSession(input.terminalId, "close"),
            catch: (cause) => terminalOperationFailure(cause, "close"),
          });
          return yield* closeSession(session, input.confirmTerminate);
        }),
      closeByTaskIds: (taskIds) =>
        Effect.gen(function* () {
          const taskIdSet = new Set(taskIds);
          const targets = [...sessions.values()].filter((session) => {
            const taskId = session.summary.context.taskId;
            return taskId !== undefined && taskIdSet.has(taskId);
          });
          const closedTerminalIds: string[] = [];
          const errors: Array<{ terminalId: string; message: string }> = [];
          for (const session of targets) {
            const result = yield* Effect.either(closeSession(session, true));
            if (result._tag === "Left")
              errors.push({ terminalId: session.summary.terminalId, message: result.left.message });
            else closedTerminalIds.push(session.summary.terminalId);
          }
          if (errors.length > 0)
            return yield* Effect.fail(
              new TerminalServiceError({
                code: "close_failed",
                operation: "close_by_task",
                message: `Failed to terminate ${errors.length} task terminal(s).`,
                details: { errors },
              }),
            );
          return { closedTerminalIds };
        }),
      dispose: () =>
        Effect.gen(function* () {
          accepting = false;
          const errors: Array<{ terminalId: string; message: string }> = [];
          for (const session of [...sessions.values()]) {
            const result = yield* Effect.either(closeSession(session, true));
            if (result._tag === "Left")
              errors.push({ terminalId: session.summary.terminalId, message: result.left.message });
          }
          if (errors.length > 0)
            return yield* Effect.fail(
              new TerminalServiceError({
                code: "close_failed",
                operation: "dispose",
                message: `Failed to terminate ${errors.length} terminal(s) during shutdown.`,
                details: { errors },
              }),
            );
        }),
    };
    return service;
  });

export { TerminalServiceError } from "./terminal-service-error";
