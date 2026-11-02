import type { TaskWorktreeOwnersRequest } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  collectImplementationResetRemovedPaths,
  collectImplementationResetSessionState,
} from "../support/implementation-reset-targets";
import {
  requireDependencies,
  requireTaskStopImpactDependencies,
} from "../support/required-task-dependencies";
import { collectRemovedWorktreePaths } from "../support/task-removed-worktrees";
import { getScopedRepoConfig } from "../support/scoped-repo-config";
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
      const { operation } = input;
      const worktreePaths =
        operation === "reset_implementation"
          ? (yield* Effect.forEach(targets, (target) =>
              collectImplementationResetSessionState(
                dependencies,
                target.workflow,
                repoConfig,
                target.taskId,
                target.sessions,
              ).pipe(
                Effect.flatMap((state) =>
                  collectImplementationResetRemovedPaths(dependencies, repoPath, target, state),
                ),
              ),
            )).flat()
          : yield* collectRemovedWorktreePaths(
              { ...dependencies, taskWorktreeService },
              operation,
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
