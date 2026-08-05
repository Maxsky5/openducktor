import { Effect, Exit } from "effect";
import { TaskAssetError } from "../../effect/task-asset-error";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import {
  asTaskAssetError,
  sameTaskAssetIds,
  type TaskAssetAwareMutationDependencies,
  taskAssetPartialStateError,
  toNewTaskAssetRecords,
} from "./task-asset-aware-task-store-support";
import { collectTaskDescriptionAssetIds } from "./task-asset-markdown";

export const createTaskAssetAwareCreate =
  ({
    inner,
    registry,
    filePort,
    staging,
    persistence,
    resolveWorkspaceIdForRepoPath,
  }: TaskAssetAwareMutationDependencies): TaskStorePort["createTask"] =>
  (input) => {
    let createdTaskId: string | undefined;
    let workspaceId: string | undefined;
    let committed = false;
    let committedCleanupPhase: "purge_create_quarantine" | "discard_committed_staging" =
      "discard_committed_staging";
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
                  durableState: "unchanged",
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
        committedCleanupPhase = "purge_create_quarantine";
        yield* filePort.purgeQuarantine(recoveryId);
        recoveryId = null;
      }
      if (stagedAssets.length > 0) {
        committedCleanupPhase = "discard_committed_staging";
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
          let message =
            "The task was created, but staged-file cleanup failed. Refresh before continuing.";
          if (committedCleanupPhase === "purge_create_quarantine") {
            message =
              "The task was created, but its asset quarantine could not be removed. Refresh before continuing.";
          }
          return Effect.fail(
            taskAssetPartialStateError({
              operation: "create",
              phase: committedCleanupPhase,
              taskId,
              assetIds: promotedAssetIds,
              durableState: "committed_cleanup_pending",
              message,
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
  };
