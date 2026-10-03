import { Effect } from "effect";
import { type HostError, toHostOperationError } from "../../effect/host-errors";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
export const createLiveSessionRootRefsReader =
  ({
    store,
    taskStore,
    settings,
    reportReads,
  }: {
    store: WorkspaceSessionStorePort;
    taskStore: TaskStorePort;
    settings: Pick<WorkspaceSettingsService, "getRepoConfigByRepoPath">;
    reportReads?: (repoPath: string, durableHostReads: number) => Effect.Effect<void, HostError>;
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
      if (reportReads) yield* reportReads(repoPath, tasks.length ? 3 : 2);
      return [
        ...chats.flatMap((chat) =>
          chat.externalSessionId === null
            ? []
            : [
                {
                  sessionScope: { kind: "repository" as const },
                  repoPath,
                  runtimeKind: chat.runtimeKind,
                  externalSessionId: chat.externalSessionId,
                  workingDirectory: chat.executionTarget.workingDirectory,
                },
              ],
        ),
        ...records.flatMap((task) =>
          task.agentSessions.map((session) => ({
            sessionScope: { kind: "workflow" as const, taskId: task.taskId, role: session.role },
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
