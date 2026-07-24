import { Effect, Exit } from "effect";
import { TaskAssetError } from "../../effect/task-asset-error";
import type { TaskAssetFilePort } from "../../ports/task-asset-file-port";
import type { TaskAssetRegistryPort } from "../../ports/task-asset-registry-port";
import type { TaskDescriptionAssetPersistencePort } from "../../ports/task-description-asset-persistence-port";
import type { TaskStoreError, TaskStorePort } from "../../ports/task-repository-ports";
import { createTaskAssetAwareDelete } from "./task-asset-aware-delete";
import {
  asTaskAssetError,
  sameTaskAssetIds,
  taskAssetPartialStateError,
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
  persistence: TaskDescriptionAssetPersistencePort | null;
  resolveWorkspaceIdForRepoPath: ResolveWorkspaceIdForRepoPath;
};

export const createTaskAssetAwareTaskStore = ({
  inner,
  registry,
  filePort,
  staging,
  persistence,
  resolveWorkspaceIdForRepoPath,
}: CreateTaskAssetAwareTaskStoreInput): TaskStorePort => ({
  ...inner,
  createTask(input) {
    let createdTaskId: string | undefined;
    let workspaceId: string | undefined;
    let committed = false;
    let recoveryId: string | null = null;
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
      if (referencedAssetIds.size === 0) {
        return yield* inner.createTask({ repoPath: input.repoPath, task: input.task });
      }
      if (!persistence) {
        return yield* new TaskAssetError({
          operation: "create",
          code: "validation",
          assetIds: Array.from(referencedAssetIds),
          failedPhase: "validate_asset_persistence",
          durableState: "unchanged",
          retryAllowed: false,
          message:
            "Task description assets require a task store composed with shared asset persistence.",
        });
      }
      const assetPersistence = persistence;
      const resolvedWorkspaceId = yield* resolveWorkspaceIdForRepoPath(input.repoPath);
      workspaceId = resolvedWorkspaceId;
      const stagedAssets = yield* staging.getStagedAssets({
        workspaceId: resolvedWorkspaceId,
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
      const created = yield* assetPersistence.createTaskWithDescriptionAssets({
        repoPath: input.repoPath,
        task: input.task,
        assets: toNewTaskAssetRecords(stagedAssets),
        prepareFiles: (taskId) =>
          Effect.gen(function* () {
            createdTaskId = taskId;
            recoveryId = yield* filePort.quarantineAssets({
              workspaceId: resolvedWorkspaceId,
              taskId,
              assetIds: [],
              promotedAssetIds: stagedAssets.map((asset) => asset.assetId),
              operation: "create",
            });

            for (const asset of stagedAssets) {
              if (
                yield* filePort.durableExists({
                  workspaceId: resolvedWorkspaceId,
                  taskId,
                  assetId: asset.assetId,
                  operation: "create",
                })
              ) {
                return yield* new TaskAssetError({
                  operation: "create",
                  code: "validation",
                  taskId,
                  assetIds: [asset.assetId],
                  failedPhase: "check_destination",
                  durableState: "created_partial",
                  retryAllowed: false,
                  message: `Task asset destination ${asset.assetId} already exists.`,
                });
              }
              yield* filePort.promote({
                workspaceId: resolvedWorkspaceId,
                taskId,
                assetId: asset.assetId,
                operation: "create",
              });
              promotedAssetIds.push(asset.assetId);
            }
          }),
      });
      committed = true;
      if (recoveryId) {
        yield* filePort.purgeQuarantine(recoveryId);
        recoveryId = null;
      }
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
        if (
          referencedAssetIds.size === 0 &&
          suppliedAssetIds.size === 0 &&
          createdTaskId === undefined
        ) {
          return Effect.fail(cause);
        }
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
        const cleanupWorkspaceId = workspaceId;
        if (!cleanupWorkspaceId) {
          return Effect.fail(
            taskAssetPartialStateError({
              operation: "create",
              phase: "compensate_create",
              taskId,
              assetIds: promotedAssetIds,
              durableState: "unknown",
              message:
                "Task creation failed after the task was created, but its workspace cleanup context is unavailable. Refresh before continuing.",
            }),
          );
        }
        return Effect.gen(function* () {
          const removeExit = yield* Effect.exit(
            promotedAssetIds.length > 0
              ? filePort.removeDurable({
                  workspaceId: cleanupWorkspaceId,
                  taskId,
                  assetIds: promotedAssetIds,
                  operation: "create",
                })
              : Effect.void,
          );
          const recoveryExit = yield* Effect.exit(
            recoveryId ? filePort.purgeQuarantine(recoveryId) : Effect.void,
          );
          if (Exit.isFailure(removeExit) || Exit.isFailure(recoveryExit)) {
            return yield* taskAssetPartialStateError({
              operation: "create",
              phase: "compensate_create",
              taskId,
              assetIds: promotedAssetIds,
              durableState: "created_partial",
              message:
                "Task creation rolled back, but file cleanup was incomplete. Refresh before continuing.",
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
    let workspaceId: string | undefined;

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
      if (!persistence) {
        if (referencedAssetIds.size > 0 || suppliedAssetIds.size > 0) {
          return yield* new TaskAssetError({
            operation: "update",
            code: "validation",
            taskId: input.taskId,
            assetIds: Array.from(new Set([...referencedAssetIds, ...suppliedAssetIds])),
            failedPhase: "validate_asset_persistence",
            durableState: "unchanged",
            retryAllowed: false,
            message:
              "Task description assets require a task store composed with shared asset persistence.",
          });
        }
        return yield* inner.updateTask(input);
      }
      workspaceId = yield* resolveWorkspaceIdForRepoPath(input.repoPath);
      const existing = yield* registry.listAssets({
        repoPath: input.repoPath,
        taskId: input.taskId,
        scope: "description",
      });
      const currentTask = yield* inner.getTask({
        repoPath: input.repoPath,
        taskId: input.taskId,
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
            operation: "update",
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
      }
      obsoleteAssetIds = existing
        .filter((asset) => !referencedAssetIds.has(asset.id))
        .map((asset) => asset.id);
      quarantineId = yield* filePort.quarantineAssets({
        workspaceId,
        taskId: input.taskId,
        assetIds: obsoleteAssetIds,
        promotedAssetIds: stagedAssets.map((asset) => asset.assetId),
        operation: "update",
      });
      for (const asset of stagedAssets) {
        yield* filePort.promote({
          workspaceId,
          taskId: input.taskId,
          assetId: asset.assetId,
          operation: "update",
        });
        promotedAssetIds.push(asset.assetId);
      }
      const updated = yield* persistence.updateTaskWithDescriptionAssets({
        repoPath: input.repoPath,
        taskId: input.taskId,
        expectedDescription: currentTask.description,
        expectedAssetIds: existing.map((asset) => asset.id),
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
        const cleanupWorkspaceId = workspaceId;
        if (!cleanupWorkspaceId) {
          return Effect.fail(error);
        }
        return Effect.gen(function* () {
          const restoreExit = quarantineId
            ? yield* Effect.exit(filePort.restoreQuarantine(quarantineId))
            : Exit.succeed(undefined);
          const removeExit =
            promotedAssetIds.length > 0
              ? yield* Effect.exit(
                  filePort.removeDurable({
                    workspaceId: cleanupWorkspaceId,
                    taskId: input.taskId,
                    assetIds: promotedAssetIds,
                    operation: "update",
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
  deleteTask: createTaskAssetAwareDelete({
    assetPersistenceEnabled: persistence !== null,
    filePort,
    inner,
    registry,
    resolveWorkspaceIdForRepoPath,
  }),
});
