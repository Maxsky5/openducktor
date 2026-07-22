import type { TaskCard, TaskUpdatePatch } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { NewTaskAssetRecord } from "./task-asset-registry-port";
import type { TaskStoreError } from "./task-repository-ports";

export type TaskDescriptionAssetPersistencePort = {
  updateTaskWithDescriptionAssets(input: {
    repoPath: string;
    taskId: string;
    expectedDescription: string;
    expectedAssetIds: string[];
    patch: TaskUpdatePatch;
    insertAssets: NewTaskAssetRecord[];
    removeAssetIds: string[];
  }): Effect.Effect<TaskCard, TaskStoreError>;
};
