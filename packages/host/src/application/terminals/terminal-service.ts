import {
  type TerminalCloseRequest,
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
import type { TerminalGrid, TerminalPtyPort } from "../../ports/terminal-pty-port";
import { TerminalPtyError } from "../../ports/terminal-pty-port";
import type { TerminalOutputSourcePort } from "../../ports/terminal-output-source-port";
import { createTerminalAdmission } from "./terminal-admission";
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

export type TerminalService = TerminalOutputSourcePort & {
  readonly hostInstanceId: string;
  create(input: TerminalCreateRequest): Effect.Effect<TerminalCreateResponse, TerminalServiceError>;
  list(filter: TerminalListFilter): Effect.Effect<TerminalListResponse, TerminalServiceError>;
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
  resolveLaunchEnvironment: TerminalLaunchEnvironmentPort;
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

    const service: TerminalService = {
      hostInstanceId,
      openOutputSource: ({ context, workingDir, label, onForgotten }) =>
        Effect.gen(function* () {
          const reservation = yield* admission.beginCreation(context);
          return yield* Effect.gen(function* () {
            yield* reservation.bind(context);
            const source = yield* engine.openOutputSource(
              {
                terminalId: idFactory(),
                label,
                context,
                initialWorkingDir: workingDir,
                createdAt: now().toISOString(),
                lifecycle: "starting",
                exit: null,
              },
              () => {
                reservation.release();
                onForgotten();
              },
            );
            return {
              ...source,
              activate: (handle: Parameters<typeof source.activate>[0]) =>
                source
                  .activate(handle)
                  .pipe(Effect.ensuring(Effect.sync(() => reservation.release()))),
              exit: (exit: Parameters<typeof source.exit>[0]) => {
                source.exit(exit);
                reservation.release();
              },
              release: () => {
                source.release();
                reservation.release();
              },
            };
          }).pipe(Effect.onError(() => Effect.sync(() => reservation.release())));
        }).pipe(
          Effect.mapError(
            (cause) =>
              new TerminalPtyError({
                code: "spawn_failed",
                operation: "start",
                message: cause.message,
                cause,
              }),
          ),
        ),
      create: (rawInput) =>
        Effect.gen(function* () {
          const input = terminalCreateRequestSchema.parse(rawInput);
          return yield* Effect.acquireUseRelease(
            admission.beginCreation("taskId" in input.context ? undefined : input.context),
            (reservation) =>
              Effect.gen(function* () {
                const resolved = yield* target.resolve(input);
                const { context, workingDir } = resolved;
                const start = Effect.gen(function* () {
                  yield* reservation.bind(context);
                  const plan = yield* launch({ workingDir, context }, DEFAULT_GRID);
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
                if (!("repoPath" in context) || !withProcessStartAdmission) {
                  return yield* start;
                }
                return yield* withProcessStartAdmission(context.repoPath, start).pipe(
                  Effect.mapError((cause) =>
                    cause instanceof TerminalServiceError
                      ? cause
                      : new TerminalServiceError({
                          code: "invalid_input",
                          operation: "create",
                          message: cause.message,
                          cause,
                          workingDir: context.repoPath,
                        }),
                  ),
                );
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
      inspectWorkspaceActivity: (canonicalRepoPath) =>
        engine.inspectWorkspaceActivity(canonicalRepoPath),
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
