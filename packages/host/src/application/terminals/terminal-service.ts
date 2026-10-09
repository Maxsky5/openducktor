import {
  type TerminalCloseRequest,
  type TerminalContext,
  type TerminalCreateRequest,
  type TerminalCreateResponse,
  type TerminalListFilter,
  type TerminalListResponse,
  type TerminalPreparePathInputRequest,
  type TerminalPreparePathInputResponse,
  type TerminalStartedBy,
  type TerminalSummary,
  type TerminalActivityMessage,
  terminalCloseRequestSchema,
  terminalCreateRequestSchema,
  terminalListFilterSchema,
  terminalPreparePathInputRequestSchema,
} from "@openducktor/contracts";
import { Effect, type Scope } from "effect";
import type { TerminalGrid, TerminalPtyPort } from "../../ports/terminal-pty-port";
import { createTerminalAdmission, type TerminalAdmissionReservation } from "./terminal-admission";
import type {
  StartedCommandTerminal,
  TerminalCommandRequest,
  TerminalCommandService,
} from "./terminal-command";
import { type TerminalTaskScope, type TerminalWorkspaceSessionScope } from "./terminal-context";
import {
  createTerminalLaunchPolicy,
  type TerminalLaunchEnvironmentPort,
} from "./terminal-launch-policy";
import { TerminalServiceError } from "./terminal-service-error";
import {
  createTerminalSessionEngine,
  type TerminalSessionAttachInput,
  type TerminalWorkspaceActivity,
} from "./terminal-session-engine";
import type { TerminalTitleSettlementScheduler } from "./terminal-title-settler";
import type { WithProcessStartAdmission } from "../workspaces/workspace-admission-service";
import { createTerminalTargetResolver, type TerminalTargetServices } from "./terminal-target";

const DEFAULT_GRID: TerminalGrid = { columns: 80, rows: 24 };

export type TerminalAttachInput = TerminalSessionAttachInput;

export type TerminalCloseByTaskResult = { closedTerminalIds: string[] };

export type TerminalService = {
  readonly hostInstanceId: string;
  create(input: TerminalCreateRequest): Effect.Effect<TerminalCreateResponse, TerminalServiceError>;
  list(filter: TerminalListFilter): Effect.Effect<TerminalListResponse, TerminalServiceError>;
  observeActivity(listener: (message: TerminalActivityMessage) => void): Effect.Effect<() => void>;
  inspectWorkspaceActivity(
    canonicalRepoPath: string,
  ): Effect.Effect<TerminalWorkspaceActivity, TerminalServiceError>;
  preparePathInput(
    input: TerminalPreparePathInputRequest,
  ): Effect.Effect<TerminalPreparePathInputResponse, TerminalServiceError>;
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
  closeByTaskScope(
    scope: TerminalTaskScope,
  ): Effect.Effect<TerminalCloseByTaskResult, TerminalServiceError>;
  acquireTaskCleanup(
    scope: TerminalTaskScope,
  ): Effect.Effect<TerminalCloseByTaskResult, TerminalServiceError, Scope.Scope>;
  acquireWorkspaceSessionCleanup(
    scope: TerminalWorkspaceSessionScope,
  ): Effect.Effect<TerminalCloseByTaskResult, TerminalServiceError, Scope.Scope>;
  dispose(): Effect.Effect<void, TerminalServiceError>;
};

type CreateTerminalServiceInput = TerminalTargetServices & {
  withProcessStartAdmission?: WithProcessStartAdmission;
  ptyPort: TerminalPtyPort;
  launchEnvironment: TerminalLaunchEnvironmentPort;
  now?: () => Date;
  idFactory?: () => string;
  hostInstanceIdFactory?: () => string;
  scheduleTitleSettlement?: TerminalTitleSettlementScheduler;
};

export const createTerminalService = ({
  withProcessStartAdmission,
  filesystem,
  git,
  taskWorktrees,
  workspaceSessions,
  ptyPort,
  launchEnvironment,
  now = () => new Date(),
  idFactory = () => globalThis.crypto.randomUUID(),
  hostInstanceIdFactory = () => globalThis.crypto.randomUUID(),
  scheduleTitleSettlement,
}: CreateTerminalServiceInput): Effect.Effect<TerminalService & TerminalCommandService> =>
  Effect.sync(() => {
    const hostInstanceId = hostInstanceIdFactory();
    const engineInput: Parameters<typeof createTerminalSessionEngine>[0] = { now, ptyPort };
    if (scheduleTitleSettlement) {
      engineInput.scheduleTitleSettlement = scheduleTitleSettlement;
    }
    const engine = createTerminalSessionEngine(engineInput);
    const launch = createTerminalLaunchPolicy({ filesystem, environment: launchEnvironment });
    const admission = createTerminalAdmission({
      countLive: engine.countLive,
      countLiveForContext: engine.countLiveForContext,
    });
    const target = createTerminalTargetResolver({
      filesystem,
      git,
      taskWorktrees,
      workspaceSessions,
    });
    const canonicalizeRepositoryPath = target.canonicalizeRepositoryPath;
    const canonicalizeTaskScope = (
      scope: TerminalTaskScope,
    ): Effect.Effect<TerminalTaskScope, TerminalServiceError> =>
      canonicalizeRepositoryPath(scope.repoPath, "close_by_task").pipe(
        Effect.map((repoPath) => ({ repoPath, taskIds: scope.taskIds })),
      );

    // Task contexts bind after target resolution gives their canonical repository path.
    const withCreationReservation = <A>(
      context: TerminalContext,
      use: (reservation: TerminalAdmissionReservation) => Effect.Effect<A, TerminalServiceError>,
    ): Effect.Effect<A, TerminalServiceError> =>
      Effect.acquireUseRelease(
        admission.beginCreation("taskId" in context ? undefined : context),
        use,
        (reservation) => Effect.sync(() => reservation.release()),
      );

    const newSummary = (
      context: TerminalContext,
      label: string,
      initialWorkingDir: string,
      startedBy: TerminalStartedBy,
    ): TerminalSummary => ({
      terminalId: idFactory(),
      label,
      context,
      initialWorkingDir,
      createdAt: now().toISOString(),
      lifecycle: "starting",
      exit: null,
      startedBy,
    });

    // A repository owner starts processes only while its workspace accepts them.
    const withRepositoryAdmission = <A>(
      context: TerminalContext,
      operation: "create" | "start_command",
      start: Effect.Effect<A, TerminalServiceError>,
    ): Effect.Effect<A, TerminalServiceError> => {
      if (!("repoPath" in context) || !withProcessStartAdmission) return start;
      return withProcessStartAdmission(context.repoPath, start).pipe(
        Effect.mapError((cause) =>
          cause instanceof TerminalServiceError
            ? cause
            : new TerminalServiceError({
                code: "invalid_input",
                operation,
                message: cause.message,
                cause,
                workingDir: context.repoPath,
              }),
        ),
      );
    };

    const startShellTerminal = (
      reservation: TerminalAdmissionReservation,
      context: TerminalContext,
      workingDir: string,
    ): Effect.Effect<TerminalCreateResponse, TerminalServiceError> =>
      withRepositoryAdmission(
        context,
        "create",
        Effect.gen(function* () {
          yield* reservation.bind(context);
          const plan = yield* launch.shell({ workingDir, context }, DEFAULT_GRID);
          return yield* engine.startShell(newSummary(context, plan.cwd, plan.cwd, "user"), plan);
        }),
      );

    const startCommandTerminal = (
      reservation: TerminalAdmissionReservation,
      request: TerminalCommandRequest,
    ): Effect.Effect<StartedCommandTerminal, TerminalServiceError> =>
      withRepositoryAdmission(
        request.context,
        "start_command",
        Effect.gen(function* () {
          yield* reservation.bind(request.context);
          const plans = yield* launch.command(request, DEFAULT_GRID, request.commandLines);
          return yield* engine.startCommand(
            newSummary(request.context, request.label, plans.shell.cwd, request.startedBy),
            request,
            plans,
          );
        }),
      );

    const service: TerminalService & TerminalCommandService = {
      hostInstanceId,
      create: (rawInput) =>
        Effect.gen(function* () {
          const input = terminalCreateRequestSchema.parse(rawInput);
          return yield* withCreationReservation(input.context, (reservation) =>
            Effect.gen(function* () {
              const { context, workingDir } = yield* target.resolve(input);
              return yield* startShellTerminal(reservation, context, workingDir);
            }),
          );
        }),
      startCommand: (request) =>
        withCreationReservation(request.context, (reservation) =>
          Effect.gen(function* () {
            const resolved = yield* target.resolveOwned(request);
            return yield* startCommandTerminal(reservation, { ...request, ...resolved });
          }),
        ),
      startCommandInPreparedTarget: (request) =>
        withCreationReservation(request.context, (reservation) =>
          startCommandTerminal(reservation, request),
        ),
      readOutputTail: engine.readOutputTail,
      list: (rawFilter) =>
        Effect.gen(function* () {
          const filter = terminalListFilterSchema.parse(rawFilter);
          const canonicalFilter =
            filter.kind === "task"
              ? {
                  ...filter,
                  repoPath: yield* canonicalizeRepositoryPath(filter.repoPath, "list"),
                }
              : filter;
          return { hostInstanceId, terminals: engine.list(canonicalFilter) };
        }),
      observeActivity: (listener) => Effect.sync(() => engine.observeActivity(listener)),
      inspectWorkspaceActivity: engine.inspectWorkspaceActivity,
      preparePathInput: (rawInput) =>
        Effect.gen(function* () {
          const input = terminalPreparePathInputRequestSchema.parse(rawInput);
          const text = yield* engine.preparePathInput(input.terminalId, input.paths);
          return { text };
        }),
      attach: engine.attach,
      write: (terminalId, data) =>
        Effect.gen(function* () {
          const context = engine.getContext(terminalId);
          const write = engine.write(terminalId, data);
          if (!context || !("repoPath" in context) || !withProcessStartAdmission) {
            return yield* write;
          }
          yield* withProcessStartAdmission(context.repoPath, write).pipe(
            Effect.mapError((cause) =>
              cause instanceof TerminalServiceError
                ? cause
                : new TerminalServiceError({
                    code: "invalid_input",
                    operation: "write",
                    message: cause.message,
                    cause,
                    terminalId,
                    workingDir: context.repoPath,
                  }),
            ),
          );
        }),
      resize: engine.resize,
      acknowledge: engine.acknowledge,
      detach: engine.detach,
      close: (rawInput) =>
        Effect.gen(function* () {
          const input = terminalCloseRequestSchema.parse(rawInput);
          yield* engine.close(input.terminalId, input.confirmTerminate);
        }),
      closeByTaskScope: (scope) =>
        Effect.gen(function* () {
          const canonicalScope = yield* canonicalizeTaskScope(scope);
          const closedTerminalIds = yield* engine.closeByTaskScope(canonicalScope);
          return { closedTerminalIds };
        }),
      acquireTaskCleanup: (scope) =>
        Effect.gen(function* () {
          const cleanupLease = yield* Effect.acquireRelease(
            Effect.acquireUseRelease(
              admission.beginTaskCleanupPreparation(),
              () =>
                canonicalizeTaskScope(scope).pipe(
                  Effect.flatMap((canonicalScope) =>
                    admission
                      .acquireTaskCleanupLease(canonicalScope)
                      .pipe(Effect.map((lease) => ({ canonicalScope, lease }))),
                  ),
                ),
              (preparation) => Effect.sync(() => preparation.release()),
            ),
            ({ lease }) => Effect.sync(() => lease.release()),
          );
          yield* cleanupLease.lease.awaitPending;
          const closedTerminalIds = yield* engine.closeByTaskScope(cleanupLease.canonicalScope);
          return { closedTerminalIds };
        }),
      acquireWorkspaceSessionCleanup: (scope) =>
        Effect.gen(function* () {
          const lease = yield* Effect.acquireRelease(
            admission.acquireWorkspaceSessionCleanupLease(scope),
            (held) => Effect.sync(() => held.release()),
          );
          yield* lease.awaitPending;
          const closedTerminalIds = yield* engine.closeByWorkspaceSession(scope);
          return { closedTerminalIds };
        }),
      dispose: () =>
        Effect.gen(function* () {
          yield* admission.stopAccepting();
          yield* engine.dispose();
        }),
    };
    return service;
  });

export { TerminalServiceError, terminalServiceErrorToFailure } from "./terminal-service-error";
