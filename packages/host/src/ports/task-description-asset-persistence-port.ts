import type { TaskCreateInput, TaskUpdatePatch } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { NewTaskAssetRecord } from "./task-asset-registry-port";
import type { TaskStoreError, TaskRecord } from "./task-repository-ports";

export type TaskDescriptionAssetPersistencePort = {
  createTaskWithDescriptionAssets(input: {
    repoPath: string;
    task: TaskCreateInput;
    /** The initial state of the task workflow. */
    status: string;
    assets: NewTaskAssetRecord[];
    prepareFiles(taskId: string): Effect.Effect<void, TaskStoreError>;
  }): Effect.Effect<TaskRecord, TaskStoreError>;
  updateTaskWithDescriptionAssets(input: {
    repoPath: string;
    taskId: string;
    expectedTask: TaskRecord;
    expectedAssetIds: string[];
    patch: TaskUpdatePatch;
    insertAssets: NewTaskAssetRecord[];
    removeAssetIds: string[];
  }): Effect.Effect<TaskRecord, TaskStoreError>;
};
