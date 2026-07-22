import type { Effect } from "effect";
import type { TaskAssetError } from "../effect/task-asset-error";

export type TaskAssetFilePort = {
  stage(input: {
    workspaceId: string;
    assetId: string;
    bytes: Uint8Array;
  }): Effect.Effect<void, TaskAssetError>;
  removeStaged(input: {
    workspaceId: string;
    assetIds: string[];
  }): Effect.Effect<void, TaskAssetError>;
  clearStaging(): Effect.Effect<number, TaskAssetError>;
  promote(input: {
    workspaceId: string;
    taskId: string;
    assetId: string;
  }): Effect.Effect<void, TaskAssetError>;
  durableExists(input: {
    workspaceId: string;
    taskId: string;
    assetId: string;
  }): Effect.Effect<boolean, TaskAssetError>;
  removeDurable(input: {
    workspaceId: string;
    taskId: string;
    assetIds: string[];
  }): Effect.Effect<void, TaskAssetError>;
  quarantineAssets(input: {
    workspaceId: string;
    taskId: string;
    assetIds: string[];
  }): Effect.Effect<string | null, TaskAssetError>;
  quarantineTaskDirectory(input: {
    workspaceId: string;
    taskId: string;
  }): Effect.Effect<string | null, TaskAssetError>;
  restoreQuarantine(quarantineId: string): Effect.Effect<void, TaskAssetError>;
  purgeQuarantine(quarantineId: string): Effect.Effect<void, TaskAssetError>;
  readDurable(input: {
    workspaceId: string;
    taskId: string;
    assetId: string;
  }): Effect.Effect<Uint8Array | null, TaskAssetError>;
};
