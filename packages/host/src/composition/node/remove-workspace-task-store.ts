import { Effect } from "effect";
import { HostOperationError, type HostOperationErrorAggregate } from "../../effect/host-errors";
import type { TaskStorePort } from "../../ports/task-repository-ports";

export type RemoveWorkspaceTaskStore = (
  workspaceId: string,
) => Effect.Effect<void, HostOperationErrorAggregate>;

export type AssertPermanentRemovalSupported = (
  workspaceId: string,
) => Effect.Effect<void, HostOperationErrorAggregate>;

const configuredTaskStoreRemovalError = (workspaceId: string): HostOperationErrorAggregate =>
  new HostOperationError({
    operation: "workspace.removeTaskStore",
    message: `Cannot remove the task store for workspace ${workspaceId}. Permanent removal is not supported with a configured task store.`,
  });

export const createAssertPermanentRemovalSupported = ({
  configuredTaskStore,
}: {
  configuredTaskStore?: TaskStorePort | undefined;
}): AssertPermanentRemovalSupported =>
  configuredTaskStore
    ? (workspaceId) => Effect.fail(configuredTaskStoreRemovalError(workspaceId))
    : () => Effect.void;

export const createRemoveWorkspaceTaskStore = ({
  closeWorkspace,
  configuredTaskStore,
  removeDirectory,
}: {
  closeWorkspace: (workspaceId: string) => Effect.Effect<void, HostOperationErrorAggregate>;
  configuredTaskStore?: TaskStorePort | undefined;
  removeDirectory: (workspaceId: string) => Effect.Effect<void, HostOperationError>;
}): RemoveWorkspaceTaskStore => {
  if (configuredTaskStore) {
    return (workspaceId) => Effect.fail(configuredTaskStoreRemovalError(workspaceId));
  }

  return (workspaceId) =>
    Effect.gen(function* () {
      yield* closeWorkspace(workspaceId);
      yield* removeDirectory(workspaceId);
    });
};
