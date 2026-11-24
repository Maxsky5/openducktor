import type {
  AgentSessionAuthorizedRoot,
  WorkflowTaskRef,
  WorkspaceRecord,
} from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import type { AgentSessionLiveStateService } from "../agent-sessions/agent-session-live-state-service";
import type { TaskSyncService } from "../tasks/sync/task-sync-service";
import type { WorkspaceSettingsService } from "../workspaces/workspace-settings-service";
import type { RunningTaskSession } from "./workflow-task-moves";

/**
 * Reads the agent sessions that run on this host for tasks, with the role of each. A session runs
 * when its live activity on this host is not idle, as for the workspace activity check. A session
 * that waits on background work reports a running activity. Its saved root gives the task and the
 * role.
 */
export const createRunningTaskSessionsReader =
  ({
    live,
    readSessionRootRefs,
    settings,
  }: {
    live: Pick<AgentSessionLiveStateService, "list">;
    readSessionRootRefs: (
      repoPath: string,
    ) => Effect.Effect<AgentSessionAuthorizedRoot[], HostError>;
    settings: Pick<WorkspaceSettingsService, "getWorkspaceCatalog">;
  }) =>
  (): Effect.Effect<RunningTaskSession[], HostError> =>
    Effect.gen(function* () {
      const catalog = yield* settings.getWorkspaceCatalog();
      const repoPaths = [...new Set(catalog.openWorkspaces.map(({ repoPath }) => repoPath))];
      const running = yield* Effect.forEach(repoPaths, (repoPath) =>
        Effect.gen(function* () {
          const working = (yield* live.list({ repoPath })).filter(
            ({ activity }) => activity !== "idle",
          );
          if (working.length === 0) return [];
          const liveKeys = new Set(working.map(({ ref }) => agentSessionRefKey(ref)));
          const roots = yield* readSessionRootRefs(repoPath);
          return roots.flatMap(({ sessionScope, ...ref }) =>
            sessionScope.kind === "workflow" && liveKeys.has(agentSessionRefKey(ref))
              ? [
                  {
                    workspaceId: sessionScope.workspaceId,
                    taskId: sessionScope.taskId,
                    role: sessionScope.role,
                  },
                ]
              : [],
          );
        }),
      );
      return running.flat();
    });

/**
 * Publishes the changes of moved tasks on the task stream, one event per open workspace. A closed
 * workspace has no observers; it reads its tasks again when it opens.
 */
export const createMovedTaskPublisher =
  ({
    settings,
    taskSync,
  }: {
    settings: Pick<WorkspaceSettingsService, "getWorkspaceCatalog">;
    taskSync: Pick<TaskSyncService, "publishTasksUpdated">;
  }) =>
  (tasks: readonly WorkflowTaskRef[]): Effect.Effect<void, HostError> =>
    Effect.gen(function* () {
      const catalog = yield* settings.getWorkspaceCatalog();
      const openWorkspaces = new Map<string, WorkspaceRecord>(
        catalog.openWorkspaces.map((workspace) => [workspace.workspaceId, workspace]),
      );
      const taskIdsByWorkspace = new Map<string, string[]>();
      for (const { workspaceId, taskId } of tasks)
        taskIdsByWorkspace.set(workspaceId, [
          ...(taskIdsByWorkspace.get(workspaceId) ?? []),
          taskId,
        ]);
      yield* Effect.forEach(
        taskIdsByWorkspace,
        ([workspaceId, taskIds]) => {
          const workspace = openWorkspaces.get(workspaceId);
          if (!workspace) return Effect.void;
          return taskSync.publishTasksUpdated(
            { workspaceId, repoPath: workspace.repoPath },
            { taskIds, removedTaskIds: [] },
            "move-task-workflow",
            [],
          );
        },
        { discard: true },
      );
    });
