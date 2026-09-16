import type {
  RepoConfig,
  WorkspaceCatalog,
  WorkspaceLifecycleTargetInput,
  WorkspaceRemovalCommandResult,
  WorkspaceRemovalInput,
  WorkspaceRemovalPhase,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import {
  errorMessage,
  HostOperationError,
  type HostOperationErrorAggregate,
  HostValidationError,
  type HostValidationErrorAggregate,
} from "../../effect/host-errors";
import type { GitPort, GitPortError } from "../../ports/git-port";
import type { SettingsConfigPort, SettingsConfigError } from "../../ports/settings-config-port";
import type { TaskStoreError, TaskStorePort } from "../../ports/task-repository-ports";
import type { WorktreeFileError, WorktreeFilePort } from "../../ports/worktree-file-port";
import type {
  WorkspaceActivityBlocker,
  WorkspaceActivityPort,
} from "../../ports/workspace-activity-port";
import type { WorkspaceStoragePort } from "../../ports/workspace-storage-port";
import type {
  WorkspaceHostOwnershipError,
  WorkspaceHostOwnershipPort,
} from "../../ports/workspace-host-ownership-port";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import { removeWorktreeAndFilesystemPath } from "../git/worktree-removal";
import type { RuntimeOrchestratorService } from "../runtimes/runtime-orchestrator-service";
import { managedWorktreeBaseForRepoConfig } from "../tasks/support/task-cleanup-support";
import type { WorkspaceAdmissionService } from "./workspace-admission-service";
import type { WorkspaceOwnershipLock } from "./workspace-ownership-lock";
import { runWorkspaceLifecycleReservation } from "./workspace-lifecycle-reservation";
import type { WorkspaceSettingsError, WorkspaceSettingsService } from "./workspace-settings-model";
import {
  collectWorkspaceTaskWorktreePaths,
  type WorkspaceWorktreeInventoryError,
} from "./workspace-worktree-inventory";

export type WorkspaceLifecycleError =
  | GitPortError
  | HostOperationErrorAggregate
  | HostValidationErrorAggregate
  | SettingsConfigError
  | TaskStoreError
  | WorktreeFileError
  | WorkspaceHostOwnershipError
  | WorkspaceSettingsError
  | WorkspaceWorktreeInventoryError;

type WorkspaceCatalogEffect = Effect.Effect<WorkspaceCatalog, WorkspaceLifecycleError>;
type WorkspaceRemovalEffect = Effect.Effect<WorkspaceRemovalCommandResult, WorkspaceLifecycleError>;
export type WorkspaceLifecycleService = {
  closeWorkspace(input: WorkspaceLifecycleTargetInput): WorkspaceCatalogEffect;
  reopenWorkspace(input: WorkspaceLifecycleTargetInput): WorkspaceCatalogEffect;
  removeWorkspace(input: WorkspaceRemovalInput): WorkspaceRemovalEffect;
};
type CreateWorkspaceLifecycleServiceInput = {
  activity: WorkspaceActivityPort;
  admission: Pick<
    WorkspaceAdmissionService,
    | "awaitWorkStarts"
    | "blockWorkspace"
    | "forgetWorkspaceWhenDrained"
    | "releaseReservation"
    | "reserveWorkspace"
    | "unblockWorkspace"
    | "withAdministrativeAccess"
  >;
  gitPort: Pick<
    GitPort,
    "canonicalizePath" | "isRegisteredWorktree" | "listWorktrees" | "removeWorktree"
  >;
  hostOwnership: Pick<WorkspaceHostOwnershipPort, "claimWorkspace" | "releaseWorkspace">;
  ownershipLock: WorkspaceOwnershipLock;
  runtimeOrchestrator: Pick<RuntimeOrchestratorService, "clearRepoRuntimeStartupStatuses">;
  settingsConfig: SettingsConfigPort;
  storage: WorkspaceStoragePort;
  taskStore: Pick<TaskStorePort, "listTasks" | "listAgentSessionsForTasks">;
  workspaceSessionStore: Pick<WorkspaceSessionStorePort, "listAll">;
  workspaceSettingsService: Pick<
    WorkspaceSettingsService,
    | "beginWorkspaceRemoval"
    | "closeWorkspace"
    | "getRepoConfig"
    | "getWorkspaceCatalog"
    | "recordWorkspaceRemovalProgress"
    | "removeWorkspaceRegistration"
    | "reopenWorkspace"
  >;
  worktreeFiles: Pick<
    WorktreeFilePort,
    "pathIsWithinRoot" | "removePathIfPresent" | "resolvePathWithinRoot" | "resolveWorktreePath"
  >;
};
const blockingActivityMessage = (blockers: WorkspaceActivityBlocker[]): string =>
  `Stop the running work before closing or removing this workspace: ${blockers
    .map((blocker) => blocker.label)
    .join("; ")}.`;

const unwrapUnknownError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

export const createWorkspaceLifecycleService = ({
  activity,
  admission,
  gitPort,
  hostOwnership,
  ownershipLock,
  runtimeOrchestrator,
  settingsConfig,
  storage,
  taskStore,
  workspaceSessionStore,
  workspaceSettingsService,
  worktreeFiles,
}: CreateWorkspaceLifecycleServiceInput): WorkspaceLifecycleService => {
  const requireTarget = (workspaceId: string, expectedRepoPath: string) =>
    Effect.gen(function* () {
      const repoConfig = yield* workspaceSettingsService.getRepoConfig(workspaceId);
      if (repoConfig.repoPath !== expectedRepoPath) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `Workspace ${workspaceId} changed since the dialog opened. Reload workspaces and retry.`,
            field: "repoPath",
            details: { expectedRepoPath, actualRepoPath: repoConfig.repoPath },
          }),
        );
      }
      return repoConfig;
    });

  const assertNoBlockingActivity = (repoPath: string) =>
    Effect.gen(function* () {
      yield* admission.awaitWorkStarts(repoPath);
      const blockers = yield* activity.inspect(repoPath);
      if (blockers.length > 0) {
        return yield* Effect.fail(
          new HostValidationError({
            message: blockingActivityMessage(blockers),
            field: "workspaceId",
            details: { blockers, repoPath },
          }),
        );
      }
    });

  const collectWorktreePaths = (
    input: WorkspaceRemovalInput,
    repoConfig: RepoConfig,
    pendingWorktreePath: string | null,
  ) =>
    Effect.gen(function* () {
      const catalog = yield* workspaceSettingsService.getWorkspaceCatalog();
      return yield* admission.withAdministrativeAccess(
        [
          input.workspaceId,
          ...catalog.openWorkspaces.map((workspace) => workspace.workspaceId),
          ...catalog.closedWorkspaces.map((workspace) => workspace.workspaceId),
          ...catalog.incompleteRemovals.map((removal) => removal.workspace.workspaceId),
        ],
        collectWorkspaceTaskWorktreePaths(
          {
            gitPort,
            settingsConfig,
            taskStore,
            workspaceSessionStore,
            workspaceSettingsService,
            workspaceTaskStoreExists: storage.workspaceTaskStoreExists,
          },
          repoConfig,
          pendingWorktreePath,
        ),
      );
    });

  const persistProgress = (
    workspaceId: string,
    phase: WorkspaceRemovalPhase,
    removedWorktrees: string[],
    lastFailure: string | null,
    pendingWorktreePath: string | null | undefined = undefined,
  ) =>
    workspaceSettingsService.recordWorkspaceRemovalProgress({
      workspaceId,
      phase,
      removedWorktrees,
      lastFailure,
      pendingWorktreePath,
    });

  const failRemovalPhase = (
    workspaceId: string,
    phase: WorkspaceRemovalPhase,
    removedWorktrees: string[],
    failedPath: string | undefined,
    message: string,
    cause: WorkspaceLifecycleError | Error = new Error(message),
  ) => {
    const failure = (failureMessage: string, failureCause: WorkspaceLifecycleError | Error) =>
      new HostOperationError({
        operation: `workspace.removeWorkspace.${phase}`,
        message: failureMessage,
        cause: unwrapUnknownError(failureCause),
        details: { failedPath, phase, removedWorktrees, workspaceId },
      });
    return persistProgress(workspaceId, phase, removedWorktrees, message).pipe(
      Effect.mapError((journalFailure) =>
        failure(`${message} Progress save failed: ${journalFailure.message}`, journalFailure),
      ),
      Effect.zipRight(Effect.fail(failure(message, cause))),
    );
  };

  const executeRemoval = (input: WorkspaceRemovalInput, repoConfig: RepoConfig) =>
    Effect.gen(function* () {
      yield* storage.assertPermanentRemovalSupported(input.workspaceId);
      if (!repoConfig.removal) {
        yield* assertNoBlockingActivity(repoConfig.repoPath);
      } else {
        yield* admission.awaitWorkStarts(repoConfig.repoPath);
      }
      const preflightWorktreePaths =
        !repoConfig.removal && input.removeTaskWorktrees
          ? yield* collectWorktreePaths(input, repoConfig, null)
          : null;
      const { record: startedRecord, repoConfig: journaledRepoConfig } =
        yield* workspaceSettingsService.beginWorkspaceRemoval({
          workspaceId: input.workspaceId,
          expectedRepoPath: input.expectedRepoPath,
          removeTaskWorktrees: input.removeTaskWorktrees,
        });
      admission.blockWorkspace({
        reason: "removal",
        repoPath: journaledRepoConfig.repoPath,
        workspaceId: input.workspaceId,
      });
      const removedWorktrees = [...startedRecord.removedWorktrees];
      let phase = startedRecord.phase;
      yield* activity.releaseWorkspaceSessions(journaledRepoConfig.repoPath).pipe(
        Effect.zipRight(activity.releaseWorkspaceRuntimes(journaledRepoConfig.repoPath)),
        Effect.catchAll((cause) =>
          failRemovalPhase(
            input.workspaceId,
            phase,
            removedWorktrees,
            undefined,
            `Failed to release workspace sessions and runtimes: ${errorMessage(cause)}. Retry removal to continue.`,
            cause,
          ),
        ),
      );
      if (phase === "worktrees" && startedRecord.removeTaskWorktrees) {
        const managedWorktreeBasePath = managedWorktreeBaseForRepoConfig(
          settingsConfig,
          journaledRepoConfig,
        );
        const removedComparisons = new Set(
          removedWorktrees.map((path) => normalizePathForComparison(path)),
        );
        const pendingPath = startedRecord.pendingWorktreePath;
        let worktreePaths = preflightWorktreePaths;
        if (worktreePaths === null) {
          const inventoryResult = yield* Effect.either(
            collectWorktreePaths(input, journaledRepoConfig, pendingPath),
          );
          if (inventoryResult._tag === "Left") {
            return yield* failRemovalPhase(
              input.workspaceId,
              "worktrees",
              removedWorktrees,
              undefined,
              errorMessage(inventoryResult.left),
              inventoryResult.left,
            );
          }
          worktreePaths = inventoryResult.right;
        }
        if (
          pendingPath !== null &&
          !worktreePaths.some(
            (path) => normalizePathForComparison(path) === normalizePathForComparison(pendingPath),
          )
        ) {
          return yield* failRemovalPhase(
            input.workspaceId,
            "worktrees",
            removedWorktrees,
            pendingPath,
            `OpenDucktor cannot verify that ${pendingPath} was deleted. Retry with its storage connected. If the path was already deleted while storage was unavailable, create an empty directory at that path and retry.`,
          );
        }
        for (const worktreePath of worktreePaths) {
          if (removedComparisons.has(normalizePathForComparison(worktreePath))) {
            continue;
          }
          const result = yield* Effect.either(
            persistProgress(input.workspaceId, "worktrees", removedWorktrees, null, worktreePath),
          );
          if (result._tag === "Left") {
            return yield* Effect.fail(
              new HostOperationError({
                operation: "workspace.removeWorkspace.worktrees",
                message: `Cannot journal the pending worktree deletion of ${worktreePath}: ${result.left.message}. Retry removal to continue.`,
                cause: unwrapUnknownError(result.left),
                details: {
                  failedPath: worktreePath,
                  workspaceId: input.workspaceId,
                },
              }),
            );
          }
          const removalResult = yield* Effect.either(
            removeWorktreeAndFilesystemPath(
              { gitPort, settingsConfig, worktreeFiles },
              {
                force: true,
                managedWorktreeBasePath,
                missingOutsideManagedRootPathPolicy: "skip",
                repoPath: journaledRepoConfig.repoPath,
                worktreePath,
              },
            ),
          );
          if (removalResult._tag === "Left") {
            return yield* failRemovalPhase(
              input.workspaceId,
              "worktrees",
              removedWorktrees,
              worktreePath,
              `Removed ${removedWorktrees.length} task worktree(s). Failed to remove ${worktreePath}: ${removalResult.left.message}. Retry removal to continue. If it keeps failing, delete that directory manually. Local branches and committed history stay.`,
              removalResult.left,
            );
          }
          if (!removalResult.right.filesystemDeletionVerified) {
            return yield* failRemovalPhase(
              input.workspaceId,
              "worktrees",
              removedWorktrees,
              worktreePath,
              `OpenDucktor cannot verify that ${worktreePath} was deleted because the path was unavailable. Reconnect its storage and retry. If the path was already deleted, create an empty directory at that path and retry.`,
            );
          }
          removedWorktrees.push(worktreePath);
          removedComparisons.add(normalizePathForComparison(worktreePath));
          yield* persistProgress(input.workspaceId, "worktrees", removedWorktrees, null, null);
        }
        phase = "task_store";
        yield* persistProgress(input.workspaceId, phase, removedWorktrees, null);
      }

      if (phase === "task_store") {
        const storeResult = yield* Effect.either(
          storage.removeWorkspaceTaskStore(input.workspaceId),
        );
        if (storeResult._tag === "Left") {
          const retryHint =
            storeResult.left.operation === "sqliteTaskRepository.closeWorkspace"
              ? "Restart OpenDucktor, then retry removal."
              : "Retry removal to continue.";
          return yield* failRemovalPhase(
            input.workspaceId,
            "task_store",
            removedWorktrees,
            undefined,
            `Failed to remove the workspace task store: ${storeResult.left.message}. The workspace stays frozen. ${retryHint}`,
            storeResult.left,
          );
        }
        phase = "attachments";
        yield* persistProgress(input.workspaceId, phase, removedWorktrees, null);
      }

      if (phase === "attachments") {
        yield* admission.awaitWorkStarts(journaledRepoConfig.repoPath);
        const assetsResult = yield* Effect.either(
          storage.removeWorkspaceTaskAssets(input.workspaceId),
        );
        if (assetsResult._tag === "Left") {
          return yield* failRemovalPhase(
            input.workspaceId,
            "attachments",
            removedWorktrees,
            undefined,
            `Failed to remove workspace task attachments: ${assetsResult.left.message}. Retry removal to continue.`,
            assetsResult.left,
          );
        }
      }

      yield* runtimeOrchestrator.clearRepoRuntimeStartupStatuses(journaledRepoConfig.repoPath);
      yield* hostOwnership.releaseWorkspace(input.workspaceId);
      while (
        !(yield* admission.forgetWorkspaceWhenDrained({
          repoPath: journaledRepoConfig.repoPath,
          workspaceId: input.workspaceId,
        }))
      ) {
        yield* admission.awaitWorkStarts(journaledRepoConfig.repoPath);
      }
      const catalog = yield* workspaceSettingsService.removeWorkspaceRegistration(
        input.workspaceId,
        input.expectedRepoPath,
      );
      return { catalog, removedWorktrees };
    });

  return {
    closeWorkspace(input) {
      return ownershipLock.runExclusive(
        Effect.gen(function* () {
          const repoConfig = yield* requireTarget(input.workspaceId, input.expectedRepoPath);
          if (repoConfig.closed) {
            yield* activity.releaseWorkspaceSessions(repoConfig.repoPath);
            yield* activity.releaseWorkspaceRuntimes(repoConfig.repoPath);
            yield* storage.closeWorkspaceTaskStore(input.workspaceId);
            yield* hostOwnership.releaseWorkspace(input.workspaceId);
            return yield* workspaceSettingsService.getWorkspaceCatalog();
          }
          return yield* runWorkspaceLifecycleReservation(
            admission,
            hostOwnership,
            {
              operation: "close",
              repoPath: repoConfig.repoPath,
              workspaceId: input.workspaceId,
            },
            () =>
              Effect.gen(function* () {
                yield* assertNoBlockingActivity(repoConfig.repoPath);
                yield* activity.releaseWorkspaceSessions(repoConfig.repoPath);
                yield* activity.releaseWorkspaceRuntimes(repoConfig.repoPath);
                const catalog = yield* workspaceSettingsService.closeWorkspace(
                  input.workspaceId,
                  input.expectedRepoPath,
                );
                admission.blockWorkspace({
                  reason: "closed",
                  repoPath: repoConfig.repoPath,
                  workspaceId: input.workspaceId,
                });
                yield* storage.closeWorkspaceTaskStore(input.workspaceId);
                yield* hostOwnership.releaseWorkspace(input.workspaceId);
                return catalog;
              }),
          );
        }),
      );
    },
    reopenWorkspace(input) {
      return ownershipLock.runExclusive(
        Effect.gen(function* () {
          const repoConfig = yield* requireTarget(input.workspaceId, input.expectedRepoPath);
          return yield* runWorkspaceLifecycleReservation(
            admission,
            hostOwnership,
            {
              operation: "reopen",
              repoPath: repoConfig.repoPath,
              workspaceId: input.workspaceId,
            },
            () =>
              Effect.gen(function* () {
                yield* storage.closeWorkspaceTaskStore(input.workspaceId);
                const catalog = yield* workspaceSettingsService.reopenWorkspace(
                  input.workspaceId,
                  input.expectedRepoPath,
                );
                admission.unblockWorkspace(input.workspaceId);
                return catalog;
              }),
          );
        }),
      );
    },
    removeWorkspace(input) {
      return ownershipLock.runExclusive(
        Effect.gen(function* () {
          const repoConfig = yield* requireTarget(input.workspaceId, input.expectedRepoPath);
          return yield* runWorkspaceLifecycleReservation(
            admission,
            hostOwnership,
            {
              operation: "remove",
              repoPath: repoConfig.repoPath,
              workspaceId: input.workspaceId,
            },
            () => executeRemoval(input, repoConfig),
          );
        }),
      );
    },
  };
};
