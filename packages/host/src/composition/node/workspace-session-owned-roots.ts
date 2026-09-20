import { Effect } from "effect";
import { toHostOperationError } from "../../effect/host-errors";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
export const createWorkspaceSessionOwnedRootsReader =
  ({
    store,
    taskStore,
    settings,
  }: {
    store: WorkspaceSessionStorePort;
    taskStore: TaskStorePort;
    settings: Pick<WorkspaceSettingsService, "getRepoConfigByRepoPath">;
  }) =>
  (repoPath: string) =>
    Effect.gen(function* () {
      const config = yield* settings.getRepoConfigByRepoPath(repoPath);
      const chats = yield* store.listActive({
        workspaceId: config.workspaceId,
        repoPath,
      });
      const tasks = yield* taskStore.listTasks({ repoPath });
      const records = tasks.length
        ? yield* taskStore.listAgentSessionsForTasks({
            repoPath,
            taskIds: tasks.map((task) => task.id),
          })
        : [];
      return [
        ...chats.flatMap((chat) =>
          chat.externalSessionId === null
            ? []
            : [
                {
                  repoPath,
                  runtimeKind: chat.runtimeKind,
                  externalSessionId: chat.externalSessionId,
                  workingDirectory: chat.executionTarget.workingDirectory,
                },
              ],
        ),
        ...records.flatMap((task) =>
          task.agentSessions.map((session) => ({
            repoPath,
            runtimeKind: session.runtimeKind,
            externalSessionId: session.externalSessionId,
            workingDirectory: session.workingDirectory,
          })),
        ),
      ];
    }).pipe(
      Effect.mapError((cause) => toHostOperationError(cause, "workspaceSessions.readOwnedRoots")),
    );
