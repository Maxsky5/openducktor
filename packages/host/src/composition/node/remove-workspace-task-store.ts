import { Effect } from "effect";
import { HostOperationError, type HostOperationErrorAggregate } from "../../effect/host-errors";
import type { TaskStorePort } from "../../ports/task-repository-ports";

export type RemoveWorkspaceTaskStore = (
  workspaceId: string,
) => Effect.Effect<void, HostOperationErrorAggregate>;

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
    return (workspaceId) =>
      Effect.fail(
        new HostOperationError({
          operation: "workspace.removeTaskStore",
          message: `Cannot remove the task store for workspace ${workspaceId}. Permanent removal is not supported with a configured task store.`,
        }),
      );
  }

  return (workspaceId) =>
    Effect.gen(function* () {
      yield* closeWorkspace(workspaceId);
      yield* removeDirectory(workspaceId);
    });
};
