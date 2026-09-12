import type {
  RepoConfig,
  WorkspaceCatalog,
  WorkspaceRemovalPhase,
  WorkspaceRemovalResult,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import type { TaskAssetError } from "../../effect/task-asset-error";
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
import { removeWorktreeAndFilesystemPath } from "../git/worktree-removal";
import { managedWorktreeBaseForRepoConfig } from "../tasks/support/task-cleanup-support";
import type {
  WorkspaceActivityBlocker,
  WorkspaceActivityPort,
} from "./workspace-activity-inspector";
import type { WorkspaceAdmissionService } from "./workspace-admission-service";
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
  | WorkspaceSettingsError
  | WorkspaceWorktreeInventoryError;

export type WorkspaceStoragePort = {
  assertPermanentRemovalSupported(
    workspaceId: string,
  ): Effect.Effect<void, HostOperationErrorAggregate>;
  removeWorkspaceTaskAssets(workspaceId: string): Effect.Effect<void, TaskAssetError>;
  removeWorkspaceTaskStore(workspaceId: string): Effect.Effect<void, HostOperationErrorAggregate>;
};

export type WorkspaceLifecycleService = {
  closeWorkspace(input: {
    workspaceId: string;
    expectedRepoPath: string;
  }): Effect.Effect<WorkspaceCatalog, WorkspaceLifecycleError>;
  reopenWorkspace(input: {
    workspaceId: string;
    expectedRepoPath: string;
  }): Effect.Effect<WorkspaceCatalog, WorkspaceLifecycleError>;
  removeWorkspace(input: {
    workspaceId: string;
    expectedRepoPath: string;
    removeTaskWorktrees: boolean;
  }): Effect.Effect<
    { catalog: WorkspaceCatalog; result: WorkspaceRemovalResult },
    WorkspaceLifecycleError
  >;
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
  settingsConfig: SettingsConfigPort;
  storage: WorkspaceStoragePort;
  taskStore: Pick<TaskStorePort, "listTasks" | "listAgentSessionsForTasks">;
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
  settingsConfig,
  storage,
  taskStore,
  workspaceSettingsService,
  worktreeFiles,
}: CreateWorkspaceLifecycleServiceInput): WorkspaceLifecycleService => {
  const removalSemaphore = Effect.unsafeMakeSemaphore(1);

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
    cause: unknown,
  ) =>
    Effect.gen(function* () {
      const journalResult = yield* Effect.either(
        persistProgress(workspaceId, phase, removedWorktrees, message),
      );
      if (journalResult._tag === "Left") {
        return yield* Effect.fail(
          new HostOperationError({
            operation: `workspace.removeWorkspace.${phase}`,
            message: `${message} The removal progress could not be saved: ${journalResult.left.message}`,
            cause: unwrapUnknownError(journalResult.left),
            details: { failedPath, phase, removedWorktrees, workspaceId },
          }),
        );
      }
      return yield* Effect.fail(
        new HostOperationError({
          operation: `workspace.removeWorkspace.${phase}`,
          message,
          cause: unwrapUnknownError(cause),
          details: { failedPath, phase, removedWorktrees, workspaceId },
        }),
      );
    });

  const executeRemoval = (
    input: {
      workspaceId: string;
      expectedRepoPath: string;
      removeTaskWorktrees: boolean;
    },
    repoConfig: RepoConfig,
  ) =>
    Effect.gen(function* () {
      yield* storage.assertPermanentRemovalSupported(input.workspaceId);
      if (!repoConfig.removal) {
        yield* assertNoBlockingActivity(repoConfig.repoPath);
      } else {
        yield* admission.awaitWorkStarts(repoConfig.repoPath);
      }
      yield* activity.releaseWorkspaceSessions(repoConfig.repoPath);
      const { record: startedRecord, repoConfig: journaledRepoConfig } =
        yield* workspaceSettingsService.beginWorkspaceRemoval({
          workspaceId: input.workspaceId,
          expectedRepoPath: input.expectedRepoPath,
          removeTaskWorktrees: input.removeTaskWorktrees,
        });
      const removeTaskWorktrees = startedRecord.removeTaskWorktrees;
      admission.blockWorkspace({
        reason: "removal",
        repoPath: journaledRepoConfig.repoPath,
        workspaceId: input.workspaceId,
      });

      const removedWorktrees = [...startedRecord.removedWorktrees];
      let phase = startedRecord.phase;

      if (phase === "worktrees" && removeTaskWorktrees) {
        const managedWorktreeBasePath = managedWorktreeBaseForRepoConfig(
          settingsConfig,
          journaledRepoConfig,
        );
        const removedComparisons = new Set(
          removedWorktrees.map((path) => normalizePathForComparison(path)),
        );
        const pendingWorktreePath = startedRecord.pendingWorktreePath;
        const catalog = yield* workspaceSettingsService.getWorkspaceCatalog();
        const inventoryResult = yield* Effect.either(
          admission.withAdministrativeAccess(
            [
              input.workspaceId,
              ...catalog.incompleteRemovals.map((removal) => removal.workspace.workspaceId),
            ],
            collectWorkspaceTaskWorktreePaths(
              { gitPort, settingsConfig, taskStore, workspaceSettingsService },
              journaledRepoConfig,
              pendingWorktreePath,
            ),
          ),
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
        const worktreePaths = inventoryResult.right;
        if (
          pendingWorktreePath !== null &&
          !worktreePaths.some(
            (worktreePath) =>
              normalizePathForComparison(worktreePath) ===
              normalizePathForComparison(pendingWorktreePath),
          ) &&
          !(yield* settingsConfig.pathExists(pendingWorktreePath))
        ) {
          yield* persistProgress(input.workspaceId, "worktrees", removedWorktrees, null, null);
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
                details: { failedPath: worktreePath, workspaceId: input.workspaceId },
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

      const catalog = yield* workspaceSettingsService.removeWorkspaceRegistration(
        input.workspaceId,
        input.expectedRepoPath,
      );
      while (
        !(yield* admission.forgetWorkspaceWhenDrained({
          repoPath: journaledRepoConfig.repoPath,
          workspaceId: input.workspaceId,
        }))
      ) {
        yield* admission.awaitWorkStarts(journaledRepoConfig.repoPath);
      }
      return { catalog, result: { removedWorktrees } };
    });

  const runUnderReservation = <A, E, R>(
    input: {
      operation: "close" | "reopen" | "remove";
      repoPath: string;
      workspaceId: string;
    },
    use: () => Effect.Effect<A, E, R>,
  ) =>
    Effect.acquireUseRelease(admission.reserveWorkspace(input), use, () =>
      Effect.sync(() => admission.releaseReservation(input.workspaceId)),
    );

  return {
    closeWorkspace(input) {
      return Effect.gen(function* () {
        const repoConfig = yield* requireTarget(input.workspaceId, input.expectedRepoPath);
        if (repoConfig.closed) {
          return yield* workspaceSettingsService.getWorkspaceCatalog();
        }
        return yield* runUnderReservation(
          {
            operation: "close",
            repoPath: repoConfig.repoPath,
            workspaceId: input.workspaceId,
          },
          () =>
            Effect.gen(function* () {
              yield* assertNoBlockingActivity(repoConfig.repoPath);
              const catalog = yield* workspaceSettingsService.closeWorkspace(
                input.workspaceId,
                input.expectedRepoPath,
              );
              admission.blockWorkspace({
                reason: "closed",
                repoPath: repoConfig.repoPath,
                workspaceId: input.workspaceId,
              });
              return catalog;
            }),
        );
      });
    },
    reopenWorkspace(input) {
      return Effect.gen(function* () {
        const repoConfig = yield* requireTarget(input.workspaceId, input.expectedRepoPath);
        return yield* runUnderReservation(
          {
            operation: "reopen",
            repoPath: repoConfig.repoPath,
            workspaceId: input.workspaceId,
          },
          () =>
            Effect.gen(function* () {
              const catalog = yield* workspaceSettingsService.reopenWorkspace(
                input.workspaceId,
                input.expectedRepoPath,
              );
              admission.unblockWorkspace(input.workspaceId);
              return catalog;
            }),
        );
      });
    },
    removeWorkspace(input) {
      return removalSemaphore.withPermits(1)(
        Effect.gen(function* () {
          const repoConfig = yield* requireTarget(input.workspaceId, input.expectedRepoPath);
          return yield* runUnderReservation(
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
