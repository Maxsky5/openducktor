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
import { HostResourceError } from "../../effect/host-errors";
import type { FilesystemPort } from "../../ports/filesystem-port";
import type { GitPort } from "../../ports/git-port";
import type { TerminalGrid, TerminalPtyPort } from "../../ports/terminal-pty-port";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import { createTerminalAdmission } from "./terminal-admission";
import {
  isWorkspaceSessionTerminalContext,
  type TerminalTaskScope,
  type TerminalWorkspaceSessionScope,
} from "./terminal-context";
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
import type { WorkspaceSettingsService } from "../workspaces/workspace-settings-model";
import { validateWorkspaceSessionTarget } from "../workspaces/workspace-session-target";

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
  acquireWorkspaceSessionCleanup(
    scope: TerminalWorkspaceSessionScope,
  ): Effect.Effect<TerminalCloseByTaskResult, TerminalServiceError, Scope.Scope>;
  dispose(): Effect.Effect<void, TerminalServiceError>;
};

type CreateTerminalServiceInput = {
  withProcessStartAdmission?: WithProcessStartAdmission;
  filesystem: FilesystemPort;
  workspaceSessions?: {
    settings: Pick<WorkspaceSettingsService, "getRepoConfig">;
    store: Pick<WorkspaceSessionStorePort, "get">;
    git: GitPort;
  };
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
    const resolveWorkspaceSession = (
      context: Extract<TerminalContext, { kind: "workspace_session" }>,
      workingDir: string,
    ): Effect.Effect<{ context: TerminalContext; workingDir: string }, TerminalServiceError> =>
      Effect.gen(function* () {
        if (!workspaceSessions) {
          return yield* new TerminalServiceError({
            code: "workspace_session_unavailable",
            operation: "create",
            message: "Workspace Session terminal support is unavailable. Restart the host.",
          });
        }
        const { settings, store, git } = workspaceSessions;
        const config = yield* settings.getRepoConfig(context.workspaceId).pipe(
          Effect.mapError(
            (cause) =>
              new TerminalServiceError({
                code: "workspace_session_unavailable",
                operation: "create",
                message: `Cannot read Workspace ${context.workspaceId}: ${cause.message}`,
                cause,
              }),
          ),
        );
        const repoPath = yield* git.canonicalizePath(config.repoPath).pipe(
          Effect.mapError(
            (cause) =>
              new TerminalServiceError({
                code: "workspace_session_unavailable",
                operation: "create",
                message: `Cannot resolve Workspace repository: ${cause.message}`,
                cause,
              }),
          ),
        );
        const requestedRepoPath = yield* git.canonicalizePath(context.repoPath).pipe(
          Effect.mapError(
            (cause) =>
              new TerminalServiceError({
                code: "workspace_session_unavailable",
                operation: "create",
                message: `Cannot resolve requested repository: ${cause.message}`,
                cause,
              }),
          ),
        );
        if (requestedRepoPath !== repoPath) {
          return yield* new TerminalServiceError({
            code: "workspace_session_unavailable",
            operation: "create",
            message: "Workspace repository changed. Reopen this chat and retry the terminal.",
          });
        }
        const session = yield* store
          .get({ workspaceId: context.workspaceId, sessionId: context.sessionId, repoPath })
          .pipe(
            Effect.mapError(
              (cause) =>
                new TerminalServiceError({
                  code: "workspace_session_unavailable",
                  operation: "create",
                  message:
                    cause instanceof HostResourceError
                      ? `Workspace Session ${context.sessionId} no longer exists. Select an active chat.`
                      : `Cannot read Workspace Session ${context.sessionId}: ${cause.message}`,
                  cause,
                }),
            ),
          );
        if (session.archivedAt !== null) {
          return yield* new TerminalServiceError({
            code: "workspace_session_unavailable",
            operation: "create",
            message: "This chat is archived. Restore it before opening a terminal.",
          });
        }
        const target = session.executionTarget;
        if (target.kind === "local_worktree" && target.worktreeState === "removed") {
          return yield* new TerminalServiceError({
            code: "workspace_session_unavailable",
            operation: "create",
            message:
              "This chat's worktree was removed. Restore the worktree before opening a terminal.",
          });
        }
        yield* validateWorkspaceSessionTarget({ git }, repoPath, target).pipe(
          Effect.mapError(
            (cause) =>
              new TerminalServiceError({
                code: "workspace_session_unavailable",
                operation: "create",
                message: `Cannot use this chat's saved directory: ${cause.message}`,
                cause,
              }),
          ),
        );
        const requestedWorkingDir = yield* git.canonicalizePath(workingDir).pipe(
          Effect.mapError(
            (cause) =>
              new TerminalServiceError({
                code: "invalid_working_directory",
                operation: "create",
                message: `Cannot resolve requested terminal directory: ${cause.message}`,
                workingDir,
                cause,
              }),
          ),
        );
        const savedWorkingDir = yield* git.canonicalizePath(target.workingDirectory).pipe(
          Effect.mapError(
            (cause) =>
              new TerminalServiceError({
                code: "workspace_session_unavailable",
                operation: "create",
                message: `Cannot resolve this chat's saved directory: ${cause.message}`,
                cause,
              }),
          ),
        );
        if (requestedWorkingDir !== savedWorkingDir) {
          return yield* new TerminalServiceError({
            code: "invalid_working_directory",
            operation: "create",
            message: `Terminal directory does not match this chat's saved directory: ${target.workingDirectory}. Reopen the chat and retry.`,
            workingDir,
          });
        }
        return {
          context: { ...context, repoPath },
          workingDir: savedWorkingDir,
        };
      });
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
            admission.beginCreation(
              isWorkspaceSessionTerminalContext(input.context) ? input.context : undefined,
            ),
            (reservation) =>
              Effect.gen(function* () {
                const resolved = isWorkspaceSessionTerminalContext(input.context)
                  ? yield* resolveWorkspaceSession(input.context, input.workingDir)
                  : {
                      context: yield* canonicalizeContext(input.context, "create"),
                      workingDir: input.workingDir,
                    };
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
      inspectWorkspaceActivity: (repoPath) =>
        Effect.gen(function* () {
          const canonicalRepoPath = yield* canonicalizeRepositoryPath(repoPath, "list");
          return yield* engine.inspectWorkspaceActivity(canonicalRepoPath);
        }),
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
