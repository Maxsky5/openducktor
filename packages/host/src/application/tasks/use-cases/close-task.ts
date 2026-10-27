import { DEFAULT_BRANCH_PREFIX } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostDependencyError } from "../../../effect/host-errors";
import { requireDependencies } from "../support/required-task-dependencies";
import {
  requireTaskCloseDependencies,
  requireTaskCloseWorktreeService,
} from "../support/task-cleanup-dependencies";
import {
  appendTaskCleanupProgress,
  createTaskCleanupProgressState,
  recordStoppedAgentSessionCount,
} from "../support/task-cleanup-progress";
import {
  collectRelatedTaskBranches,
  managedWorktreeBaseForRepoConfig,
  runTaskLocalCleanup,
  selectWorkflowCleanupSessionRecords,
  taskHasSessionsForRoles,
  workflowRoleIds,
} from "../support/task-cleanup-support";
import { collectCloseWorktreePaths } from "../support/task-close-cleanup";
import { completeTaskClosure } from "../support/task-closure";
import { requireEffect } from "../support/task-workflow-events";
import { enrichTask } from "../support/task-workflow-helpers";
import type { TaskService, TaskServiceUseCaseInput } from "../task-service";

export const createTaskCloseUseCase = ({
  gitPort,
  taskStore,
  taskWorkflows,
  taskActivityGuard,
  settingsConfig,
  terminalService,
  taskWorktreeService,
  worktreeFiles,
  workspaceSettingsService,
  taskSessionLifecycleCoordinator,
}: TaskServiceUseCaseInput): Pick<TaskService, "closeTask"> => ({
  closeTask(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const current = yield* taskStore.getTask({ repoPath, taskId });
      const workflow = taskWorkflows.forTask(current);
      const decision = yield* requireEffect(workflow, "task.close", current);
      if (decision.kind === "unchanged") {
        return enrichTask(workflow, current);
      }

      const dependencies = yield* requireDependencies(() =>
        requireTaskCloseDependencies(gitPort, settingsConfig, workspaceSettingsService),
      );
      const repoConfig =
        yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const effectiveRepoPath = yield* dependencies.gitPort.canonicalizePath(repoConfig.repoPath);
      const managedWorktreeBasePath = managedWorktreeBaseForRepoConfig(
        dependencies.settingsConfig,
        repoConfig,
      );
      const branchPrefix = repoConfig.branchPrefix.trim() || DEFAULT_BRANCH_PREFIX;
      const cleanupProgress = createTaskCleanupProgressState();
      const cleanup = Effect.gen(function* () {
        const currentMetadata = yield* taskStore.getTaskMetadata({ repoPath, taskId });
        const currentSessions = currentMetadata.agentSessions;
        const hasWorkflowSessions = taskHasSessionsForRoles(
          currentSessions,
          workflowRoleIds(workflow),
        );
        if (hasWorkflowSessions && !taskActivityGuard) {
          return yield* Effect.fail(
            new HostDependencyError({
              dependency: "taskActivityGuard",
              operation: "task_close",
              message:
                "task_close requires runtime session activity checks for tasks with spec, planner, build, or QA sessions.",
              details: { repoPath, taskId },
            }),
          );
        }
        const taskWorktreePath = dependencies.settingsConfig.join(managedWorktreeBasePath, taskId);
        const taskWorktreePathExists =
          yield* dependencies.settingsConfig.pathExists(taskWorktreePath);
        let taskWorktreeDependency = taskWorktreeService;
        if (!taskWorktreeDependency && taskWorktreePathExists) {
          taskWorktreeDependency = yield* requireDependencies(() =>
            requireTaskCloseWorktreeService(taskWorktreeService),
          );
        }
        const closeWorktreeDependencies = taskWorktreeDependency
          ? { ...dependencies, taskWorktreeService: taskWorktreeDependency }
          : dependencies;
        const worktreePaths = yield* collectCloseWorktreePaths(
          closeWorktreeDependencies,
          effectiveRepoPath,
          workflow,
          current,
          currentSessions,
        );
        yield* taskSessionLifecycleCoordinator.acquireWorktreeLifecycle(worktreePaths);
        const branchNames = yield* collectRelatedTaskBranches(
          dependencies.gitPort,
          effectiveRepoPath,
          branchPrefix,
          [taskId],
          worktreePaths,
          "close",
        );
        if (hasWorkflowSessions && taskActivityGuard) {
          const { stoppedSessionCount } = yield* taskActivityGuard.cleanupTaskSessions({
            repoPath: effectiveRepoPath,
            taskSessions: [
              {
                taskId,
                sessions: selectWorkflowCleanupSessionRecords(workflow, currentSessions),
              },
            ],
          });
          recordStoppedAgentSessionCount(cleanupProgress, stoppedSessionCount);
        }
        yield* runTaskLocalCleanup({
          branchNames,
          gitPort: dependencies.gitPort,
          managedWorktreeBasePath,
          progress: cleanupProgress,
          repoPath: effectiveRepoPath,
          settingsConfig: dependencies.settingsConfig,
          taskIds: [taskId],
          terminalService,
          worktreeCleanupOperation: "task_close",
          worktreeFiles,
          worktreePaths,
        });
      });

      return yield* Effect.gen(function* () {
        const updated = yield* completeTaskClosure({
          cleanup,
          gitPort: dependencies.gitPort,
          operation: "close task",
          repoPath: effectiveRepoPath,
          taskId,
          taskSessionLifecycleCoordinator,
          taskStore,
          decision,
        });
        return enrichTask(workflow, updated);
      }).pipe(
        Effect.catch((error) =>
          Effect.fail(
            appendTaskCleanupProgress(error, {
              operation: "task_close",
              removedWorktrees: cleanupProgress.removedWorktrees,
              deletedBranches: cleanupProgress.deletedBranches,
              completedSteps: cleanupProgress.completedSteps,
            }),
          ),
        ),
      );
    }).pipe(Effect.scoped);
  },
});
