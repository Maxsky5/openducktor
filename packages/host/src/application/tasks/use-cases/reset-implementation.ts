import { DEFAULT_BRANCH_PREFIX } from "@openducktor/contracts";
import { canResetImplementationFromStatus } from "../../../domain/task";
import {
  requireImplementationResetStoreDependencies,
  requireTaskDeleteDependencies,
} from "../support/required-task-dependencies";
import {
  appendResetCleanupProgress,
  collectRelatedTaskBranches,
  collectResetWorktreePaths,
  implementationSessionRoleNames,
  implementationSessionRoles,
  replaceTaskInList,
  resetImplementationRollbackStatus,
  taskHasSessionsForRoles,
} from "../support/reset-cleanup";
import { enrichTask } from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskImplementationResetUseCase = ({
  devServerService,
  gitPort,
  taskStore,
  taskActivityGuard,
  settingsConfig,
  workspaceSettingsService,
}: CreateTaskServiceInput): Pick<TaskService, "resetImplementation"> => ({
  async resetImplementation(input) {
    const { repoPath, taskId } = input;
    const dependencies = requireTaskDeleteDependencies(
      devServerService,
      gitPort,
      settingsConfig,
      workspaceSettingsService,
    );
    const storeDependencies = requireImplementationResetStoreDependencies(taskStore);
    const currentTasks = await taskStore.listTasks({ repoPath });
    const current = currentTasks.find((task) => task.id === taskId);
    if (!current) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (!canResetImplementationFromStatus(current.status)) {
      throw new Error(
        `Implementation reset is only allowed from in_progress, blocked, ai_review, or human_review (current: ${current.status}).`,
      );
    }

    if (taskHasSessionsForRoles(current, implementationSessionRoles)) {
      if (!taskActivityGuard) {
        throw new Error(
          "task_reset_implementation requires runtime session activity checks for tasks with build or QA sessions.",
        );
      }
      await taskActivityGuard.ensureNoActiveTaskResetActivity({
        repoPath,
        taskId,
        sessions: current.agentSessions ?? [],
        operationLabel: "reset implementation",
        sessionRoles: [...implementationSessionRoleNames],
      });
    }

    const repoConfig =
      await dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
    const effectiveRepoPath = repoConfig.repoPath;
    const branchPrefix = repoConfig.branchPrefix.trim() || DEFAULT_BRANCH_PREFIX;
    const rollbackStatus = resetImplementationRollbackStatus(current);
    const worktreePaths = await collectResetWorktreePaths(
      dependencies,
      effectiveRepoPath,
      branchPrefix,
      current,
      implementationSessionRoles,
      "reset implementation",
    );
    const branchNames = await collectRelatedTaskBranches(
      dependencies.gitPort,
      effectiveRepoPath,
      branchPrefix,
      [taskId],
    );
    const removedWorktrees: string[] = [];
    const deletedBranches: string[] = [];

    try {
      await dependencies.devServerService.stop({ repoPath: effectiveRepoPath, taskId });
      for (const worktreePath of worktreePaths) {
        await dependencies.gitPort.removeWorktree(effectiveRepoPath, worktreePath, true);
        removedWorktrees.push(worktreePath);
      }
      for (const branchName of branchNames) {
        await dependencies.gitPort.deleteLocalBranch(effectiveRepoPath, branchName, true);
        deletedBranches.push(branchName);
      }
      await storeDependencies.clearAgentSessionsByRoles({
        repoPath: effectiveRepoPath,
        taskId,
        roles: [...implementationSessionRoleNames],
      });
      await storeDependencies.clearQaReports({ repoPath: effectiveRepoPath, taskId });
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
      const updated = await taskStore.transitionTask({
        repoPath: effectiveRepoPath,
        taskId,
        status: rollbackStatus,
      });
      return enrichTask(updated, replaceTaskInList(currentTasks, updated));
    } catch (error) {
      throw appendResetCleanupProgress(error, removedWorktrees, deletedBranches);
    }
  },
});
