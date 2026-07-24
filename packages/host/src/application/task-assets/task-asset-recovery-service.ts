import { Effect } from "effect";
import { TaskAssetError } from "../../effect/task-asset-error";
import type { TaskAssetFilePort } from "../../ports/task-asset-file-port";
import type { TaskAssetRegistryPort } from "../../ports/task-asset-registry-port";
import type { TaskStoreError, TaskStorePort } from "../../ports/task-repository-ports";

type RecoveryFilePort = Pick<
  TaskAssetFilePort,
  "durableExists" | "listQuarantines" | "purgeQuarantine" | "removeDurable" | "restoreQuarantine"
>;

type RecoveryRegistryPort = Pick<TaskAssetRegistryPort, "listAssets" | "taskExists">;

export type TaskAssetRecoveryService = {
  startupSweep(): Effect.Effect<number, TaskStoreError>;
};

export const createTaskAssetRecoveryService = ({
  filePort,
  registry,
  resolveRepoPath,
  taskStore,
}: {
  filePort: RecoveryFilePort;
  registry: RecoveryRegistryPort;
  resolveRepoPath: (workspaceId: string) => Effect.Effect<string, TaskStoreError>;
  taskStore: Pick<TaskStorePort, "deleteTask">;
}): TaskAssetRecoveryService => ({
  startupSweep() {
    return Effect.gen(function* () {
      const quarantines = yield* filePort.listQuarantines();
      for (const quarantine of quarantines) {
        const repoPath = yield* resolveRepoPath(quarantine.workspaceId);
        if (quarantine.operation === "delete") {
          const taskExists = yield* registry.taskExists({
            repoPath,
            taskId: quarantine.taskId,
          });
          if (taskExists) {
            yield* filePort.restoreQuarantine(quarantine.id);
          } else {
            yield* filePort.purgeQuarantine(quarantine.id);
          }
          continue;
        }

        const registered = yield* registry.listAssets({
          repoPath,
          taskId: quarantine.taskId,
          scope: "description",
        });
        const registeredIds = new Set(registered.map((asset) => asset.id));
        const retainedCount = quarantine.assetIds.filter((id) => registeredIds.has(id)).length;
        const promotedCount = quarantine.promotedAssetIds.filter((id) =>
          registeredIds.has(id),
        ).length;
        const committed =
          retainedCount === 0 && promotedCount === quarantine.promotedAssetIds.length;
        const uncommitted = retainedCount === quarantine.assetIds.length && promotedCount === 0;
        if (!committed && !uncommitted) {
          return yield* new TaskAssetError({
            operation: "startup_sweep",
            code: "partial_state",
            taskId: quarantine.taskId,
            assetIds: quarantine.assetIds,
            failedPhase: "reconcile_update_quarantine",
            durableState: "unknown",
            retryAllowed: false,
            message:
              "Task asset recovery found a partially committed asset registry update. Manual repair is required.",
          });
        }
        if (committed) {
          yield* filePort.purgeQuarantine(quarantine.id);
          continue;
        }

        const existingPromotedAssetIds: string[] = [];
        for (const assetId of quarantine.promotedAssetIds) {
          if (
            yield* filePort.durableExists({
              workspaceId: quarantine.workspaceId,
              taskId: quarantine.taskId,
              assetId,
              operation: "startup_sweep",
            })
          ) {
            existingPromotedAssetIds.push(assetId);
          }
        }

        if (quarantine.operation === "create") {
          const taskExists = yield* registry.taskExists({
            repoPath,
            taskId: quarantine.taskId,
          });
          if (taskExists) {
            yield* taskStore.deleteTask({
              repoPath,
              taskId: quarantine.taskId,
              deleteSubtasks: true,
            });
          }
          if (existingPromotedAssetIds.length > 0) {
            yield* filePort.removeDurable({
              workspaceId: quarantine.workspaceId,
              taskId: quarantine.taskId,
              assetIds: existingPromotedAssetIds,
              operation: "startup_sweep",
            });
          }
          yield* filePort.purgeQuarantine(quarantine.id);
          continue;
        }
        if (existingPromotedAssetIds.length > 0) {
          yield* filePort.removeDurable({
            workspaceId: quarantine.workspaceId,
            taskId: quarantine.taskId,
            assetIds: existingPromotedAssetIds,
            operation: "startup_sweep",
          });
        }
        yield* filePort.restoreQuarantine(quarantine.id);
      }
      return quarantines.length;
    });
  },
});
