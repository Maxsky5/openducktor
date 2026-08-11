import type { TaskCard, TaskCreateInput, TaskUpdatePatch } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { NewTaskAssetRecord } from "./task-asset-registry-port";
import type { TaskStoreError } from "./task-repository-ports";

export type TaskDescriptionAssetPersistencePort = {
  createTaskWithDescriptionAssets(input: {
    repoPath: string;
    task: TaskCreateInput;
    assets: NewTaskAssetRecord[];
    prepareFiles(taskId: string): Effect.Effect<void, TaskStoreError>;
  }): Effect.Effect<TaskCard, TaskStoreError>;
  updateTaskWithDescriptionAssets(input: {
    repoPath: string;
    taskId: string;
    expectedTask: TaskCard;
    expectedAssetIds: string[];
    patch: TaskUpdatePatch;
    insertAssets: NewTaskAssetRecord[];
    removeAssetIds: string[];
  }): Effect.Effect<TaskCard, TaskStoreError>;
};
