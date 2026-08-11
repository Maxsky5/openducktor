import { Effect, Exit } from "effect";
import { TaskAssetError } from "../../effect/task-asset-error";
import type { TaskAssetFilePort } from "../../ports/task-asset-file-port";
import type { TaskAssetRegistryPort } from "../../ports/task-asset-registry-port";
import type { TaskStoreError, TaskStorePort } from "../../ports/task-repository-ports";
import {
  asTaskAssetError,
  taskAssetPartialStateError,
  taskIdsForDelete,
} from "./task-asset-aware-task-store-support";

export const createTaskAssetAwareDelete =
  ({
    assetPersistenceEnabled,
    filePort,
    inner,
    registry,
    resolveWorkspaceIdForRepoPath,
  }: {
    assetPersistenceEnabled: boolean;
    filePort: TaskAssetFilePort;
    inner: TaskStorePort;
    registry: TaskAssetRegistryPort;
    resolveWorkspaceIdForRepoPath: (repoPath: string) => Effect.Effect<string, TaskStoreError>;
  }): TaskStorePort["deleteTask"] =>
  (input) => {
    if (!assetPersistenceEnabled) {
      return inner.deleteTask(input);
    }
    const quarantineIds: string[] = [];
    const affectedAssetIds: string[] = [];
    let committed = false;
    const remove = Effect.gen(function* () {
      const workspaceId = yield* resolveWorkspaceIdForRepoPath(input.repoPath);
      const tasks = yield* inner.listTasks({ repoPath: input.repoPath });
      const targetIds = taskIdsForDelete(tasks, input.taskId, input.deleteSubtasks);
      for (const taskId of targetIds) {
        const registered = yield* registry.listAssets({
          repoPath: input.repoPath,
          taskId,
          scope: "description",
        });
        affectedAssetIds.push(...registered.map((asset) => asset.id));
        const quarantineId = yield* filePort.quarantineTaskDirectory({ workspaceId, taskId });
        if (!quarantineId && registered.length > 0) {
          return yield* new TaskAssetError({
            operation: "delete",
            code: "partial_state",
            taskId,
            assetIds: registered.map((asset) => asset.id),
            failedPhase: "quarantine_task_directory",
            durableState: "unknown",
            retryAllowed: false,
            message: "Registered task assets are missing from durable storage.",
          });
        }
        if (quarantineId) {
          quarantineIds.push(quarantineId);
        }
      }
      const deleted = yield* inner.deleteTask({
        ...input,
        expectedTaskIds: Array.from(targetIds),
      });
      committed = true;
      for (const quarantineId of quarantineIds) {
        yield* filePort.purgeQuarantine(quarantineId);
      }
      return deleted;
    });

    return remove.pipe(
      Effect.catchAll((cause) => {
        const error = asTaskAssetError({
          cause,
          operation: "delete",
          phase: "delete_task_assets",
          message: "Failed to delete the task and its assets.",
          taskId: input.taskId,
        });
        if (committed) {
          return Effect.fail(
            taskAssetPartialStateError({
              operation: "delete",
              phase: "purge_deleted_task_assets",
              taskId: input.taskId,
              assetIds: Array.from(new Set(affectedAssetIds)),
              durableState: "committed_cleanup_pending",
              message: "The task was deleted, but quarantined asset cleanup is pending.",
            }),
          );
        }
        return Effect.gen(function* () {
          const exits = yield* Effect.forEach(quarantineIds.toReversed(), (quarantineId) =>
            Effect.exit(filePort.restoreQuarantine(quarantineId)),
          );
          if (exits.some(Exit.isFailure)) {
            return yield* taskAssetPartialStateError({
              operation: "delete",
              phase: "restore_deleted_task_assets",
              taskId: input.taskId,
              assetIds: Array.from(new Set(affectedAssetIds)),
              durableState: "unknown",
              message: "Task deletion failed and asset restoration was incomplete.",
            });
          }
          return yield* error;
        });
      }),
    );
  };
