import type { TaskWorktreeOwnersRequest } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  collectImplementationResetRemovedPaths,
  collectImplementationResetSessionState,
  previewResetRoles,
} from "../support/implementation-reset-targets";
import {
  requireDependencies,
  requireTaskStopImpactDependencies,
} from "../support/required-task-dependencies";
import { collectRemovedWorktreePaths } from "../support/task-removed-worktrees";
import { getScopedRepoConfig } from "../../workspaces/scoped-repo-config";
import { readTaskWorktreeOwners } from "../support/task-worktree-owner-guard";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

/**
 * Reads the others that need a worktree that a task action removes, for its confirmation. The
 * paths are the paths that the action removes. A Claude chat whose native history uses a worktree
 * only warns, so a failed read of that history only warns too.
 */
export const createTaskWorktreeOwnersUseCase = ({
  gitPort,
  taskStore,
  taskWorkflows,
  settingsConfig,
  taskWorktreeService,
  workspaceSettingsService,
  worktreeOwners,
}: CreateTaskServiceInput): Pick<TaskService, "getTaskWorktreeOwners"> => ({
  getTaskWorktreeOwners(input: TaskWorktreeOwnersRequest) {
    return Effect.gen(function* () {
      const dependencies = yield* requireDependencies(() =>
        requireTaskStopImpactDependencies(gitPort, settingsConfig, workspaceSettingsService),
      );
      const repoConfig = yield* getScopedRepoConfig(dependencies.workspaceSettingsService, input);
      const repoPath = yield* dependencies.gitPort.canonicalizePath(repoConfig.repoPath);
      const targets = yield* Effect.forEach([...new Set(input.taskIds)], (taskId) =>
        Effect.gen(function* () {
          const scope = { workspaceId: input.workspaceId, repoPath: input.repoPath, taskId };
          const task = yield* taskStore.getTask(scope);
          const metadata = yield* taskStore.getTaskMetadata(scope);
          return {
            task,
            taskId,
            sessions: metadata.agentSessions,
            workflow: taskWorkflows.forTask(task),
          };
        }),
      );
      const worktreePaths =
        input.operation === "reset_implementation"
          ? (yield* Effect.forEach(targets, (target) =>
              Effect.gen(function* () {
                const resetRoles = yield* previewResetRoles(
                  target.workflow,
                  target.taskId,
                  input.eventId,
                );
                const state = yield* collectImplementationResetSessionState(
                  dependencies,
                  resetRoles,
                  repoConfig,
                  target.taskId,
                  target.sessions,
                );
                return yield* collectImplementationResetRemovedPaths(
                  dependencies,
                  repoPath,
                  { ...target, resetRoles },
                  state,
                );
              }),
            )).flat()
          : yield* collectRemovedWorktreePaths(
              { ...dependencies, taskWorktreeService },
              input.operation,
              repoConfig,
              repoPath,
              targets,
            );
      return yield* readTaskWorktreeOwners(worktreeOwners, {
        workspaceId: input.workspaceId,
        repoPath,
        taskIds: targets.map(({ taskId }) => taskId),
        worktreePaths,
        history: "report",
      });
    });
  },
});
