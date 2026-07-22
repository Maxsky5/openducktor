import { Effect, Exit } from "effect";
import { TaskAssetError } from "../../effect/task-asset-error";
import type { TaskAssetFilePort } from "../../ports/task-asset-file-port";
import type { TaskAssetRegistryPort } from "../../ports/task-asset-registry-port";
import type { TaskStoreError, TaskStorePort } from "../../ports/task-repository-ports";
import {
  asTaskAssetError,
  sameTaskAssetIds,
  taskAssetPartialStateError,
  taskIdsForDelete,
  toNewTaskAssetRecords,
} from "./task-asset-aware-task-store-support";
import { collectTaskDescriptionAssetIds } from "./task-asset-markdown";
import type { TaskAssetStagingService } from "./task-asset-staging-service";

type ResolveWorkspaceIdForRepoPath = (repoPath: string) => Effect.Effect<string, TaskStoreError>;

type CreateTaskAssetAwareTaskStoreInput = {
  inner: TaskStorePort;
  registry: TaskAssetRegistryPort;
  filePort: TaskAssetFilePort;
  staging: TaskAssetStagingService;
  resolveWorkspaceIdForRepoPath: ResolveWorkspaceIdForRepoPath;
};

export const createTaskAssetAwareTaskStore = ({
  inner,
  registry,
  filePort,
  staging,
  resolveWorkspaceIdForRepoPath,
}: CreateTaskAssetAwareTaskStoreInput): TaskStorePort => ({
  ...inner,
  createTask(input) {
    let createdTaskId: string | undefined;
    let committed = false;
    const promotedAssetIds: string[] = [];
    let referencedAssetIds = new Set<string>();
    const suppliedAssetIds = new Set(input.descriptionAssets?.stagedAssetIds ?? []);

    const create = Effect.gen(function* () {
      referencedAssetIds = yield* Effect.try({
        try: () => collectTaskDescriptionAssetIds(input.task.description ?? ""),
        catch: (cause) =>
          asTaskAssetError({
            cause,
            operation: "create",
            phase: "parse_description_assets",
            message: "The task description contains an invalid asset reference.",
          }),
      });
      if (!sameTaskAssetIds(referencedAssetIds, suppliedAssetIds)) {
        return yield* new TaskAssetError({
          operation: "create",
          code: "validation",
          assetIds: Array.from(referencedAssetIds),
          failedPhase: "validate_staged_set",
          durableState: "unchanged",
          retryAllowed: true,
          message:
            "Every new task asset reference must have one supplied staged asset, and every supplied staged asset must be referenced.",
        });
      }
      const workspaceId = yield* resolveWorkspaceIdForRepoPath(input.repoPath);
      const stagedAssets = yield* staging.getStagedAssets({
        workspaceId,
        assetIds: Array.from(suppliedAssetIds),
      });
      for (const asset of stagedAssets) {
        if (yield* registry.assetIdExists({ repoPath: input.repoPath, assetId: asset.assetId })) {
          return yield* new TaskAssetError({
            operation: "create",
            code: "validation",
            assetIds: [asset.assetId],
            failedPhase: "check_registry_collision",
            durableState: "unchanged",
            retryAllowed: false,
            message: `Task asset registry ID ${asset.assetId} already exists.`,
          });
        }
      }
      const created = yield* inner.createTask({ repoPath: input.repoPath, task: input.task });
      createdTaskId = created.id;

      for (const asset of stagedAssets) {
        if (
          yield* filePort.durableExists({
            workspaceId,
            taskId: created.id,
            assetId: asset.assetId,
          })
        ) {
          return yield* new TaskAssetError({
            operation: "create",
            code: "validation",
            taskId: created.id,
            assetIds: [asset.assetId],
            failedPhase: "check_destination",
            durableState: "created_partial",
            retryAllowed: false,
            message: `Task asset destination ${asset.assetId} already exists.`,
          });
        }
        yield* filePort.promote({ workspaceId, taskId: created.id, assetId: asset.assetId });
        promotedAssetIds.push(asset.assetId);
      }
      yield* registry.registerAssets({
        repoPath: input.repoPath,
        taskId: created.id,
        assets: toNewTaskAssetRecords(stagedAssets),
      });
      committed = true;
      if (stagedAssets.length > 0) {
        yield* staging.discard({
          workspaceId,
          assetIds: stagedAssets.map((asset) => asset.assetId),
        });
      }
      return created;
    });

    return create.pipe(
      Effect.catchAll((cause) => {
        const error = asTaskAssetError({
          cause,
          operation: "create",
          phase: "create_task_with_assets",
          message: "Failed to create the task with its description assets.",
          ...(createdTaskId ? { taskId: createdTaskId } : {}),
          assetIds: Array.from(referencedAssetIds),
        });
        if (!createdTaskId) {
          return Effect.fail(error);
        }
        const taskId = createdTaskId;
        if (committed) {
          return Effect.fail(
            taskAssetPartialStateError({
              operation: "create",
              phase: "discard_committed_staging",
              taskId,
              assetIds: promotedAssetIds,
              durableState: "committed_cleanup_pending",
              message:
                "The task was created, but staged-file cleanup failed. Refresh before continuing.",
            }),
          );
        }
        return Effect.gen(function* () {
          const deleteExit = yield* Effect.exit(
            inner.deleteTask({ repoPath: input.repoPath, taskId, deleteSubtasks: true }),
          );
          const workspaceId = yield* resolveWorkspaceIdForRepoPath(input.repoPath);
          const removeExit = yield* Effect.exit(
            promotedAssetIds.length > 0
              ? filePort.removeDurable({ workspaceId, taskId, assetIds: promotedAssetIds })
              : Effect.void,
          );
          if (Exit.isFailure(deleteExit) || Exit.isFailure(removeExit)) {
            return yield* taskAssetPartialStateError({
              operation: "create",
              phase: "compensate_create",
              taskId,
              assetIds: promotedAssetIds,
              durableState: "created_partial",
              message:
                "Task creation failed and cleanup was incomplete. Refresh before continuing.",
            });
          }
          return yield* error;
        });
      }),
    );
  },
  updateTask(input) {
    if (!Object.hasOwn(input.patch, "description")) {
      if (input.descriptionAssets) {
        return Effect.fail(
          new TaskAssetError({
            operation: "update",
            code: "validation",
            taskId: input.taskId,
            assetIds: input.descriptionAssets.stagedAssetIds,
            failedPhase: "validate_description_patch",
            durableState: "unchanged",
            retryAllowed: true,
            message: "descriptionAssets requires a description patch.",
          }),
        );
      }
      return inner.updateTask(input);
    }

    let referencedAssetIds = new Set<string>();
    const suppliedAssetIds = new Set(input.descriptionAssets?.stagedAssetIds ?? []);
    const promotedAssetIds: string[] = [];
    let obsoleteAssetIds: string[] = [];
    let quarantineId: string | null = null;
    let committed = false;

    const update = Effect.gen(function* () {
      referencedAssetIds = yield* Effect.try({
        try: () => collectTaskDescriptionAssetIds(input.patch.description ?? ""),
        catch: (cause) =>
          asTaskAssetError({
            cause,
            operation: "update",
            phase: "parse_description_assets",
            message: "The task description contains an invalid asset reference.",
            taskId: input.taskId,
          }),
      });
      const workspaceId = yield* resolveWorkspaceIdForRepoPath(input.repoPath);
      const existing = yield* registry.listAssets({
        repoPath: input.repoPath,
        taskId: input.taskId,
        scope: "description",
      });
      const existingIds = new Set(existing.map((asset) => asset.id));
      for (const assetId of referencedAssetIds) {
        if (!existingIds.has(assetId) && !suppliedAssetIds.has(assetId)) {
          return yield* new TaskAssetError({
            operation: "update",
            code: "validation",
            taskId: input.taskId,
            assetIds: [assetId],
            failedPhase: "validate_ownership",
            durableState: "unchanged",
            retryAllowed: true,
            message: `Task asset ${assetId} is not owned by this task or supplied as staged content.`,
          });
        }
      }
      if (!Array.from(suppliedAssetIds).every((id) => referencedAssetIds.has(id))) {
        return yield* new TaskAssetError({
          operation: "update",
          code: "validation",
          taskId: input.taskId,
          assetIds: Array.from(suppliedAssetIds),
          failedPhase: "validate_staged_set",
          durableState: "unchanged",
          retryAllowed: true,
          message: "Every supplied staged asset must be referenced by the final description.",
        });
      }
      const stagedAssets = yield* staging.getStagedAssets({
        workspaceId,
        assetIds: Array.from(suppliedAssetIds),
      });
      for (const asset of stagedAssets) {
        if (
          existingIds.has(asset.assetId) ||
          (yield* registry.assetIdExists({ repoPath: input.repoPath, assetId: asset.assetId }))
        ) {
          return yield* new TaskAssetError({
            operation: "update",
            code: "validation",
            taskId: input.taskId,
            assetIds: [asset.assetId],
            failedPhase: "check_registry_collision",
            durableState: "unchanged",
            retryAllowed: true,
            message: `Task asset ${asset.assetId} is already registered.`,
          });
        }
        if (
          yield* filePort.durableExists({
            workspaceId,
            taskId: input.taskId,
            assetId: asset.assetId,
          })
        ) {
          return yield* new TaskAssetError({
            operation: "update",
            code: "validation",
            taskId: input.taskId,
            assetIds: [asset.assetId],
            failedPhase: "check_destination",
            durableState: "unchanged",
            retryAllowed: true,
            message: `Task asset destination ${asset.assetId} already exists.`,
          });
        }
        yield* filePort.promote({
          workspaceId,
          taskId: input.taskId,
          assetId: asset.assetId,
        });
        promotedAssetIds.push(asset.assetId);
      }
      obsoleteAssetIds = existing
        .filter((asset) => !referencedAssetIds.has(asset.id))
        .map((asset) => asset.id);
      quarantineId = yield* filePort.quarantineAssets({
        workspaceId,
        taskId: input.taskId,
        assetIds: obsoleteAssetIds,
      });
      const updated = yield* registry.updateTaskWithDescriptionAssets({
        repoPath: input.repoPath,
        taskId: input.taskId,
        patch: input.patch,
        insertAssets: toNewTaskAssetRecords(stagedAssets),
        removeAssetIds: obsoleteAssetIds,
      });
      committed = true;
      if (quarantineId) {
        yield* filePort.purgeQuarantine(quarantineId);
        quarantineId = null;
      }
      if (stagedAssets.length > 0) {
        yield* staging.discard({
          workspaceId,
          assetIds: stagedAssets.map((asset) => asset.assetId),
        });
      }
      return updated;
    });

    return update.pipe(
      Effect.catchAll((cause) => {
        const error = asTaskAssetError({
          cause,
          operation: "update",
          phase: "update_task_with_assets",
          message: "Failed to update the task description assets.",
          taskId: input.taskId,
          assetIds: Array.from(referencedAssetIds),
        });
        if (committed) {
          return Effect.fail(
            taskAssetPartialStateError({
              operation: "update",
              phase: "cleanup_after_commit",
              taskId: input.taskId,
              assetIds: Array.from(new Set([...promotedAssetIds, ...obsoleteAssetIds])),
              durableState: "committed_cleanup_pending",
              message:
                "The description was saved, but asset cleanup is pending. Refresh before editing again.",
            }),
          );
        }
        return Effect.gen(function* () {
          const workspaceId = yield* resolveWorkspaceIdForRepoPath(input.repoPath);
          const restoreExit = quarantineId
            ? yield* Effect.exit(filePort.restoreQuarantine(quarantineId))
            : Exit.succeed(undefined);
          const removeExit =
            promotedAssetIds.length > 0
              ? yield* Effect.exit(
                  filePort.removeDurable({
                    workspaceId,
                    taskId: input.taskId,
                    assetIds: promotedAssetIds,
                  }),
                )
              : Exit.succeed(undefined);
          if (Exit.isFailure(restoreExit) || Exit.isFailure(removeExit)) {
            return yield* taskAssetPartialStateError({
              operation: "update",
              phase: "compensate_update",
              taskId: input.taskId,
              assetIds: Array.from(new Set([...promotedAssetIds, ...obsoleteAssetIds])),
              durableState: "unknown",
              message:
                "The description save failed and asset restoration was incomplete. Refresh before continuing.",
            });
          }
          return yield* error;
        });
      }),
    );
  },
  deleteTask(input) {
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
      const deleted = yield* inner.deleteTask(input);
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
  },
});
