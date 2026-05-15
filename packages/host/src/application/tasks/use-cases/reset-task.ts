import { DEFAULT_BRANCH_PREFIX } from "@openducktor/contracts";
import { canResetTaskFromStatus } from "../../../domain/task";
import { removeWorktreeAndFilesystemPath } from "../../git/worktree-removal";
import {
  requireTaskDeleteDependencies,
  requireTaskResetStoreDependencies,
  requireTaskWorktreeCleanupFiles,
} from "../support/required-task-dependencies";
import {
  appendResetCleanupProgress,
  collectRelatedTaskBranches,
  collectResetWorktreePaths,
  managedWorktreeBaseForRepoConfig,
  replaceTaskInList,
  taskHasSessionsForRoles,
  taskResetSessionRoleNames,
  taskResetSessionRoles,
} from "../support/reset-cleanup";
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
  async resetTask(input) {
    const { repoPath, taskId } = input;
    const dependencies = requireTaskDeleteDependencies(
      devServerService,
      gitPort,
      settingsConfig,
      workspaceSettingsService,
    );
    const storeDependencies = requireTaskResetStoreDependencies(taskStore);
    const currentTasks = await taskStore.listTasks({ repoPath });
    const current = currentTasks.find((task) => task.id === taskId);
    if (!current) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (!canResetTaskFromStatus(current.status)) {
      throw new Error(
        `Task reset is only allowed from open, spec_ready, ready_for_dev, in_progress, blocked, ai_review, or human_review (current: ${current.status}).`,
      );
    }

    if (taskHasSessionsForRoles(current, taskResetSessionRoles)) {
      if (!taskActivityGuard) {
        throw new Error(
          "task_reset requires runtime session activity checks for tasks with spec, planner, build, or QA sessions.",
        );
      }
      await taskActivityGuard.ensureNoActiveTaskResetActivity({
        repoPath,
        taskId,
        sessions: current.agentSessions ?? [],
        operationLabel: "reset task",
        sessionRoles: [...taskResetSessionRoleNames],
      });
    }

    const repoConfig =
      await dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
    const effectiveRepoPath = repoConfig.repoPath;
    const managedWorktreeBasePath = managedWorktreeBaseForRepoConfig(
      dependencies.settingsConfig,
      repoConfig,
    );
    const branchPrefix = repoConfig.branchPrefix.trim() || DEFAULT_BRANCH_PREFIX;
    const worktreePaths = await collectResetWorktreePaths(
      dependencies,
      effectiveRepoPath,
      branchPrefix,
      current,
      taskResetSessionRoles,
      "reset task",
    );
    const branchNames = await collectRelatedTaskBranches(
      dependencies.gitPort,
      effectiveRepoPath,
      branchPrefix,
      [taskId],
    );
    const removedWorktrees: string[] = [];
    const deletedBranches: string[] = [];
    const completedSteps: string[] = [];

    try {
      await dependencies.devServerService.stop({ repoPath: effectiveRepoPath, taskId });
      for (const worktreePath of worktreePaths) {
        await removeWorktreeAndFilesystemPath(
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
          },
        );
        removedWorktrees.push(worktreePath);
      }
      for (const branchName of branchNames) {
        await dependencies.gitPort.deleteLocalBranch(effectiveRepoPath, branchName, true);
        deletedBranches.push(branchName);
      }
      await storeDependencies.clearWorkflowDocuments({ repoPath: effectiveRepoPath, taskId });
      completedSteps.push("cleared workflow documents");
      await storeDependencies.clearAgentSessionsByRoles({
        repoPath: effectiveRepoPath,
        taskId,
        roles: [...taskResetSessionRoleNames],
      });
      completedSteps.push("cleared linked agent sessions");
      await storeDependencies.setPullRequest({
        repoPath: effectiveRepoPath,
        taskId,
        pullRequest: null,
      });
      await storeDependencies.setDirectMerge({
        repoPath: effectiveRepoPath,
        taskId,
        directMerge: null,
      });
      completedSteps.push("cleared linked delivery metadata");
      const updated = await taskStore.transitionTask({
        repoPath: effectiveRepoPath,
        taskId,
        status: "open",
      });
      return enrichTask(updated, replaceTaskInList(currentTasks, updated));
    } catch (error) {
      throw appendResetCleanupProgress(error, removedWorktrees, deletedBranches, completedSteps);
    }
  },
});
