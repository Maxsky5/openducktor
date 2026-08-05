import type { TaskAssetOperation, TaskCard } from "@openducktor/contracts";
import type { Effect } from "effect";
import { TaskAssetError } from "../../effect/task-asset-error";
import type { TaskAssetFilePort } from "../../ports/task-asset-file-port";
import type {
  NewTaskAssetRecord,
  TaskAssetRegistryPort,
} from "../../ports/task-asset-registry-port";
import type { TaskDescriptionAssetPersistencePort } from "../../ports/task-description-asset-persistence-port";
import type { TaskStoreError, TaskStorePort } from "../../ports/task-repository-ports";
import type { StagedTaskAsset, TaskAssetStagingService } from "./task-asset-staging-service";

export type TaskAssetAwareMutationDependencies = {
  inner: TaskStorePort;
  registry: TaskAssetRegistryPort;
  filePort: TaskAssetFilePort;
  staging: TaskAssetStagingService;
  persistence: TaskDescriptionAssetPersistencePort | null;
  resolveWorkspaceIdForRepoPath: (repoPath: string) => Effect.Effect<string, TaskStoreError>;
};

export const sameTaskAssetIds = (left: Set<string>, right: Set<string>): boolean =>
  left.size === right.size && Array.from(left).every((id) => right.has(id));

export const asTaskAssetError = (input: {
  cause: unknown;
  operation: TaskAssetOperation;
  code?: "validation" | "promotion" | "database" | "quarantine" | "restore" | "purge";
  phase: string;
  message: string;
  taskId?: string;
  assetIds?: string[];
}): TaskAssetError => {
  if (input.cause instanceof TaskAssetError) {
    const operationMatches = input.cause.operation === input.operation;
    const taskContextMatches = !input.taskId || input.cause.taskId === input.taskId;
    if (operationMatches && taskContextMatches) {
      return input.cause;
    }
    return new TaskAssetError({
      operation: input.operation,
      code: input.cause.code,
      ...(input.taskId || input.cause.taskId ? { taskId: input.taskId ?? input.cause.taskId } : {}),
      assetIds: input.cause.assetIds,
      failedPhase: operationMatches ? input.cause.failedPhase : input.phase,
      durableState: input.cause.durableState,
      retryAllowed: input.cause.retryAllowed,
      message: input.cause.message,
      ...(input.cause.cause !== undefined ? { cause: input.cause.cause } : {}),
    });
  }
  return new TaskAssetError({
    operation: input.operation,
    code: input.code ?? "database",
    ...(input.taskId ? { taskId: input.taskId } : {}),
    assetIds: input.assetIds ?? [],
    failedPhase: input.phase,
    durableState: "unchanged",
    retryAllowed: true,
    message: input.message,
    cause: input.cause,
  });
};

export const taskAssetPartialStateError = (input: {
  operation: "create" | "update" | "delete";
  phase: string;
  taskId: string;
  assetIds: string[];
  durableState: "created_partial" | "committed_cleanup_pending" | "unknown";
  message: string;
}): TaskAssetError =>
  new TaskAssetError({
    operation: input.operation,
    code: "partial_state",
    taskId: input.taskId,
    assetIds: input.assetIds,
    failedPhase: input.phase,
    durableState: input.durableState,
    retryAllowed: false,
    message: input.message,
  });

export const toNewTaskAssetRecords = (assets: StagedTaskAsset[]): NewTaskAssetRecord[] =>
  assets.map((asset) => ({
    id: asset.assetId,
    scope: asset.scope,
    originalName: asset.originalName,
    mediaType: asset.verifiedMediaType,
    byteSize: asset.byteSize,
    createdAt: new Date(),
  }));

export const taskIdsForDelete = (
  tasks: TaskCard[],
  rootTaskId: string,
  recursive: boolean,
): string[] => {
  if (!recursive) {
    return [rootTaskId];
  }
  const result: string[] = [];
  const pending = [rootTaskId];
  while (pending.length > 0) {
    const taskId = pending.pop();
    if (!taskId || result.includes(taskId)) {
      continue;
    }
    result.push(taskId);
    for (const task of tasks) {
      if (task.parentId === taskId) {
        pending.push(task.id);
      }
    }
  }
  return result;
};
