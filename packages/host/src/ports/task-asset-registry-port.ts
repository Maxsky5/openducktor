import type {
  TaskAssetMediaType,
  TaskAssetScope,
  TaskCard,
  TaskUpdatePatch,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type { TaskStoreError } from "./task-repository-ports";

export type TaskAssetRecord = {
  id: string;
  taskId: string;
  scope: TaskAssetScope;
  originalName: string;
  mediaType: string;
  byteSize: number;
  createdAt: Date;
};

export type NewTaskAssetRecord = Omit<TaskAssetRecord, "taskId" | "mediaType"> & {
  mediaType: TaskAssetMediaType;
};

export type TaskAssetRegistryPort = {
  assetIdExists(input: {
    repoPath: string;
    assetId: string;
  }): Effect.Effect<boolean, TaskStoreError>;
  getAsset(input: {
    repoPath: string;
    taskId: string;
    scope: TaskAssetScope;
    assetId: string;
  }): Effect.Effect<TaskAssetRecord | null, TaskStoreError>;
  listAssets(input: {
    repoPath: string;
    taskId: string;
    scope: TaskAssetScope;
  }): Effect.Effect<TaskAssetRecord[], TaskStoreError>;
  registerAssets(input: {
    repoPath: string;
    taskId: string;
    assets: NewTaskAssetRecord[];
  }): Effect.Effect<void, TaskStoreError>;
  updateTaskWithDescriptionAssets(input: {
    repoPath: string;
    taskId: string;
    patch: TaskUpdatePatch;
    insertAssets: NewTaskAssetRecord[];
    removeAssetIds: string[];
  }): Effect.Effect<TaskCard, TaskStoreError>;
};
