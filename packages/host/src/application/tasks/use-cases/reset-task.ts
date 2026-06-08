import { DEFAULT_BRANCH_PREFIX } from "@openducktor/contracts";
import { Effect } from "effect";
import { canResetTaskFromStatus } from "../../../domain/task";
import { HostDependencyError, HostValidationError } from "../../../effect/host-errors";
import { removeWorktreeAndFilesystemPath } from "../../git/worktree-removal";
import { requireDependencies } from "../support/required-task-dependencies";
import {
  appendTaskCleanupProgress,
  collectRelatedTaskBranches,
  collectResetWorktreePaths,
  managedWorktreeBaseForRepoConfig,
  replaceTaskInList,
  taskHasSessionsForRoles,
  taskResetSessionRoleNames,
  taskResetSessionRoles,
} from "../support/task-cleanup-support";
import {
  requireTaskDeleteDependencies,
  requireTaskResetStoreDependencies,
  requireTaskWorktreeCleanupFiles,
} from "../support/task-reset-dependencies";
import { enrichTask } from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskFullResetUseCase = ({
  devServerService,
  gitPort,
  taskStore,
  taskActivityGuard,
  settingsConfig,
  worktreeFiles,
  workspaceSettingsService,
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
      if (taskHasSessionsForRoles(currentSessions, taskResetSessionRoles)) {
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
          repoPath,
          taskId,
          sessions: currentSessions,
          operationLabel: "reset task",
          sessionRoles: [...taskResetSessionRoleNames],
        });
      }

      const repoConfig =
        yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const effectiveRepoPath = repoConfig.repoPath;
      const managedWorktreeBasePath = managedWorktreeBaseForRepoConfig(
        dependencies.settingsConfig,
        repoConfig,
      );
      const branchPrefix = repoConfig.branchPrefix.trim() || DEFAULT_BRANCH_PREFIX;
      const worktreePaths = yield* collectResetWorktreePaths(
        dependencies,
        effectiveRepoPath,
        branchPrefix,
        current.id,
        currentSessions,
        taskResetSessionRoles,
        "reset task",
      );
      const branchNames = yield* collectRelatedTaskBranches(
        dependencies.gitPort,
        effectiveRepoPath,
        branchPrefix,
        [taskId],
      );
      const removedWorktrees: string[] = [];
      const deletedBranches: string[] = [];
      const completedSteps: string[] = [];

      return yield* Effect.gen(function* () {
        yield* dependencies.devServerService.stop({ repoPath: effectiveRepoPath, taskId });
        for (const worktreePath of worktreePaths) {
          yield* removeWorktreeAndFilesystemPath(
            {
              gitPort: dependencies.gitPort,
              settingsConfig: dependencies.settingsConfig,
              worktreeFiles: requireTaskWorktreeCleanupFiles(worktreeFiles, "task_reset"),
            },
            {
              repoPath: effectiveRepoPath,
              worktreePath,
              force: true,
              managedWorktreeBasePath,
              missingOutsideManagedRootPathPolicy: "skip",
            },
          );
          removedWorktrees.push(worktreePath);
        }
        for (const branchName of branchNames) {
          yield* dependencies.gitPort.deleteLocalBranch(effectiveRepoPath, branchName, true);
          deletedBranches.push(branchName);
        }
        yield* storeDependencies.clearWorkflowDocuments({ repoPath: effectiveRepoPath, taskId });
        completedSteps.push("cleared workflow documents");
        yield* storeDependencies.clearAgentSessionsByRoles({
          repoPath: effectiveRepoPath,
          taskId,
          roles: [...taskResetSessionRoleNames],
        });
        completedSteps.push("cleared linked agent sessions");
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
        completedSteps.push("cleared linked delivery metadata");
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
              removedWorktrees,
              deletedBranches,
              completedSteps,
            }),
          ),
        ),
      );
    });
  },
});
