import {
  type TerminalCloseRequest,
  type TerminalContext,
  type TerminalCreateRequest,
  type TerminalCreateResponse,
  type TerminalListFilter,
  type TerminalListResponse,
  type TerminalPreparePathInputRequest,
  type TerminalPreparePathInputResponse,
  type TerminalSummary,
  terminalCloseRequestSchema,
  terminalCreateRequestSchema,
  terminalListFilterSchema,
  terminalPreparePathInputRequestSchema,
} from "@openducktor/contracts";
import { Effect, type Scope } from "effect";
import type { HostValidationErrorAggregate } from "../../effect/host-errors";
import type { FilesystemPort } from "../../ports/filesystem-port";
import type { TerminalGrid, TerminalPtyPort } from "../../ports/terminal-pty-port";
import { createTerminalAdmission } from "./terminal-admission";
import type { TerminalTaskScope } from "./terminal-context";
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

const DEFAULT_GRID: TerminalGrid = { columns: 80, rows: 24 };

export type TerminalAttachInput = TerminalSessionAttachInput;

export type TerminalCloseByTaskResult = { closedTerminalIds: string[] };

export type TerminalService = {
  readonly hostInstanceId: string;
  create(input: TerminalCreateRequest): Effect.Effect<TerminalCreateResponse, TerminalServiceError>;
  list(filter: TerminalListFilter): Effect.Effect<TerminalListResponse, TerminalServiceError>;
  inspectWorkspaceActivity(
    repoPath: string,
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
  dispose(): Effect.Effect<void, TerminalServiceError>;
};

type CreateTerminalServiceInput = {
  assertWorkspaceAdmitsWork: (
    repoPath: string,
  ) => Effect.Effect<void, HostValidationErrorAggregate>;
  withWorkStartLease<A, E, R>(
    repoPath: string,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | HostValidationErrorAggregate, R>;
  filesystem: FilesystemPort;
  ptyPort: TerminalPtyPort;
  resolveLaunchEnvironment: TerminalLaunchEnvironmentPort;
  now?: () => Date;
  idFactory?: () => string;
  hostInstanceIdFactory?: () => string;
  scheduleTitleSettlement?: TerminalTitleSettlementScheduler;
};

export const createTerminalService = ({
  assertWorkspaceAdmitsWork,
  withWorkStartLease,
  filesystem,
  ptyPort,
  resolveLaunchEnvironment,
  now = () => new Date(),
  idFactory = () => globalThis.crypto.randomUUID(),
  hostInstanceIdFactory = () => globalThis.crypto.randomUUID(),
  scheduleTitleSettlement,
}: CreateTerminalServiceInput): Effect.Effect<TerminalService> =>
  Effect.sync(() => {
    const hostInstanceId = hostInstanceIdFactory();
    const engineInput: Parameters<typeof createTerminalSessionEngine>[0] = { now, ptyPort };
    if (scheduleTitleSettlement) {
      engineInput.scheduleTitleSettlement = scheduleTitleSettlement;
    }
    const engine = createTerminalSessionEngine(engineInput);
    const launch = createTerminalLaunchPolicy({
      filesystem,
      resolveEnvironment: resolveLaunchEnvironment,
    });
    const admission = createTerminalAdmission({
      countLive: engine.countLive,
      countLiveForContext: engine.countLiveForContext,
    });
    const canonicalizeRepositoryPath = (
      repoPath: string,
      operation: "create" | "list" | "close_by_task",
    ): Effect.Effect<string, TerminalServiceError> =>
      filesystem.canonicalize(repoPath).pipe(
        Effect.mapError(
          (cause) =>
            new TerminalServiceError({
              code: "working_directory_inaccessible",
              operation,
              message: `Cannot resolve terminal repository path: ${repoPath}`,
              workingDir: repoPath,
              cause,
            }),
        ),
      );
    const canonicalizeContext = (
      context: TerminalContext,
      operation: "create" | "list",
    ): Effect.Effect<TerminalContext, TerminalServiceError> =>
      "taskId" in context
        ? canonicalizeRepositoryPath(context.repoPath, operation).pipe(
            Effect.map((repoPath) => ({ repoPath, taskId: context.taskId })),
          )
        : Effect.succeed(context);
    const canonicalizeTaskScope = (
      scope: TerminalTaskScope,
    ): Effect.Effect<TerminalTaskScope, TerminalServiceError> =>
      canonicalizeRepositoryPath(scope.repoPath, "close_by_task").pipe(
        Effect.map((repoPath) => ({ repoPath, taskIds: scope.taskIds })),
      );

    const service: TerminalService = {
      hostInstanceId,
      create: (rawInput) =>
        Effect.gen(function* () {
          const input = terminalCreateRequestSchema.parse(rawInput);
          return yield* Effect.acquireUseRelease(
            admission.beginCreation(),
            (reservation) =>
              Effect.gen(function* () {
                const rawContext = input.context;
                const startTerminal = (context: TerminalContext) =>
                  Effect.gen(function* () {
                    yield* reservation.bind(context);
                    const plan = yield* launch({ ...input, context }, DEFAULT_GRID);
                    const terminalId = idFactory();
                    const summary: TerminalSummary = {
                      terminalId,
                      label: plan.cwd,
                      context,
                      initialWorkingDir: plan.cwd,
                      createdAt: now().toISOString(),
                      lifecycle: "starting",
                      exit: null,
                    };
                    const started = yield* engine.start(summary, plan);
                    return { ref: { terminalId }, summary: started };
                  });
                if ("taskId" in rawContext) {
                  return yield* withWorkStartLease(
                    rawContext.repoPath,
                    Effect.gen(function* () {
                      const context = yield* canonicalizeContext(rawContext, "create");
                      return yield* startTerminal(context);
                    }),
                  ).pipe(
                    Effect.mapError((cause) =>
                      cause instanceof TerminalServiceError
                        ? cause
                        : new TerminalServiceError({
                            code: "invalid_input",
                            operation: "create",
                            message: cause.message,
                            cause,
                            workingDir: rawContext.repoPath,
                          }),
                    ),
                  );
                }
                const context = yield* canonicalizeContext(rawContext, "create");
                return yield* startTerminal(context);
              }),
            (reservation) => Effect.sync(() => reservation.release()),
          );
        }),
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
      inspectWorkspaceActivity: (repoPath) => engine.inspectWorkspaceActivity(repoPath),
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
          if (context && "taskId" in context) {
            yield* assertWorkspaceAdmitsWork(context.repoPath).pipe(
              Effect.mapError(
                (cause) =>
                  new TerminalServiceError({
                    code: "invalid_input",
                    operation: "write",
                    message: cause.message,
                    cause,
                    terminalId,
                    workingDir: context.repoPath,
                  }),
              ),
            );
          }
          yield* engine.write(terminalId, data);
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
      dispose: () =>
        Effect.gen(function* () {
          yield* admission.stopAccepting();
          yield* engine.dispose();
        }),
    };
    return service;
  });

export { TerminalServiceError, terminalServiceErrorToFailure } from "./terminal-service-error";
