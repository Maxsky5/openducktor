import type { Effect } from "effect";
import type { TaskAssetError } from "../effect/task-asset-error";
import type {
  HostOperationErrorAggregate,
  HostPathAccessErrorAggregate,
} from "../effect/host-errors";

export type WorkspaceStoragePort = {
  assertPermanentRemovalSupported(
    workspaceId: string,
  ): Effect.Effect<void, HostOperationErrorAggregate>;
  workspaceTaskStoreExists(
    workspaceId: string,
  ): Effect.Effect<boolean, HostPathAccessErrorAggregate>;
  closeWorkspaceTaskStore(workspaceId: string): Effect.Effect<void, HostOperationErrorAggregate>;
  removeWorkspaceTaskAssets(workspaceId: string): Effect.Effect<void, TaskAssetError>;
  removeWorkspaceTaskStore(workspaceId: string): Effect.Effect<void, HostOperationErrorAggregate>;
};
