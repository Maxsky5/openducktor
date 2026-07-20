import { DEFAULT_BRANCH_PREFIX } from "@openducktor/contracts";
import { Effect } from "effect";
import { canResetTaskFromStatus } from "../../../domain/task";
import { HostDependencyError, HostValidationError } from "../../../effect/host-errors";
import { requireDependencies } from "../support/required-task-dependencies";
import {
  requireTaskDeleteDependencies,
  requireTaskResetStoreDependencies,
} from "../support/task-cleanup-dependencies";
import {
  appendTaskCleanupProgress,
  collectRelatedTaskBranches,
  collectResetWorktreePaths,
  createTaskCleanupProgressState,
  managedWorktreeBaseForRepoConfig,
  replaceTaskInList,
  runTaskLocalCleanup,
  taskHasSessionsForRoles,
  workflowCleanupSessionRoleNames,
  workflowCleanupSessionRoles,
} from "../support/task-cleanup-support";
import { enrichTask } from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskFullResetUseCase = ({
  devServerService,
  gitPort,
  taskStore,
  taskActivityGuard,
  settingsConfig,
  terminalService,
  worktreeFiles,
  workspaceSettingsService,
  taskSessionBootstrapCoordinator,
}: CreateTaskServiceInput): Pick<TaskService, "resetTask"> => ({
  resetTask(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const dependencies = yield* requireDependencies(() =>
        requireTaskDeleteDependencies(
          devServerService,
          gitPort,
          settingsConfig,
          workspaceSettingsService,
        ),
      );
      const storeDependencies = requireTaskResetStoreDependencies(taskStore);
      if (taskSessionBootstrapCoordinator) {
        const canonicalInputRepo = yield* dependencies.gitPort.canonicalizePath(repoPath);
        yield* taskSessionBootstrapCoordinator.acquireLifecycle(
          canonicalInputRepo,
          [taskId],
          "reset task",
        );
      }
      const currentTasks = yield* taskStore.listTasks({ repoPath });
      const current = currentTasks.find((task) => task.id === taskId);
      if (!current) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `Task not found: ${taskId}`,
            details: { repoPath, taskId },
          }),
        );
      }
      if (!canResetTaskFromStatus(current.status)) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `Task reset is only allowed from open, spec_ready, ready_for_dev, in_progress, blocked, ai_review, or human_review (current: ${current.status}).`,
            details: { repoPath, taskId, status: current.status },
          }),
        );
      }

      const currentMetadata = yield* taskStore.getTaskMetadata({ repoPath, taskId });
      const currentSessions = currentMetadata.agentSessions;
      const repoConfig =
        yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const effectiveRepoPath = yield* dependencies.gitPort.canonicalizePath(repoConfig.repoPath);
      if (taskHasSessionsForRoles(currentSessions, workflowCleanupSessionRoles)) {
        if (!taskActivityGuard) {
          return yield* Effect.fail(
            new HostDependencyError({
              dependency: "taskActivityGuard",
              operation: "task_reset",
              message:
                "task_reset requires runtime session activity checks for tasks with spec, planner, build, or QA sessions.",
              details: { repoPath, taskId },
            }),
          );
        }
        yield* taskActivityGuard.ensureNoActiveTaskResetActivity({
          repoPath: effectiveRepoPath,
          taskId,
          sessions: currentSessions,
          operationLabel: "reset task",
          sessionRoles: [...workflowCleanupSessionRoleNames],
        });
      }

      const managedWorktreeBasePath = managedWorktreeBaseForRepoConfig(
        dependencies.settingsConfig,
        repoConfig,
      );
      const branchPrefix = repoConfig.branchPrefix.trim() || DEFAULT_BRANCH_PREFIX;
      const worktreePaths = yield* collectResetWorktreePaths(
        dependencies,
        effectiveRepoPath,
        managedWorktreeBasePath,
        branchPrefix,
        current.id,
        currentSessions,
        workflowCleanupSessionRoles,
        "reset task",
      );
      const branchNames = yield* collectRelatedTaskBranches(
        dependencies.gitPort,
        effectiveRepoPath,
        branchPrefix,
        [taskId],
      );
      const cleanupProgress = createTaskCleanupProgressState();

      return yield* Effect.gen(function* () {
        yield* runTaskLocalCleanup({
          branchNames,
          devServerService: dependencies.devServerService,
          gitPort: dependencies.gitPort,
          managedWorktreeBasePath,
          progress: cleanupProgress,
          repoPath: effectiveRepoPath,
          settingsConfig: dependencies.settingsConfig,
          taskIds: [taskId],
          terminalService,
          worktreeCleanupOperation: "task_reset",
          worktreeFiles,
          worktreePaths,
        });
        yield* storeDependencies.clearWorkflowDocuments({ repoPath: effectiveRepoPath, taskId });
        cleanupProgress.completedSteps.push("cleared workflow documents");
        yield* storeDependencies.clearAgentSessionsByRoles({
          repoPath: effectiveRepoPath,
          taskId,
          roles: [...workflowCleanupSessionRoleNames],
        });
        cleanupProgress.completedSteps.push("cleared linked agent sessions");
        yield* storeDependencies.setPullRequest({
          repoPath: effectiveRepoPath,
          taskId,
          pullRequest: null,
        });
        yield* storeDependencies.setDirectMerge({
          repoPath: effectiveRepoPath,
          taskId,
          directMerge: null,
        });
        cleanupProgress.completedSteps.push("cleared linked delivery metadata");
        const updated = yield* taskStore.transitionTask({
          repoPath: effectiveRepoPath,
          taskId,
          status: "open",
        });
        return enrichTask(updated, replaceTaskInList(currentTasks, updated));
      }).pipe(
        Effect.catchAll((error) =>
          Effect.fail(
            appendTaskCleanupProgress(error, {
              operation: "task_reset",
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
