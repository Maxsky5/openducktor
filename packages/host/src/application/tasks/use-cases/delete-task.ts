import { DEFAULT_BRANCH_PREFIX } from "@openducktor/contracts";
import { requireTaskDeleteDependencies } from "../support/required-task-dependencies";
import {
  appendDeleteCleanupProgress,
  collectDeleteWorktreePaths,
  collectRelatedTaskBranches,
  collectTaskDeleteTargets,
  taskHasImplementationSessions,
} from "../support/reset-cleanup";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskDeleteUseCase = ({
  devServerService,
  gitPort,
  taskStore,
  taskActivityGuard,
  settingsConfig,
  workspaceSettingsService,
}: CreateTaskServiceInput): Pick<TaskService, "deleteTask"> => ({
  async deleteTask(input) {
    const { repoPath, taskId, deleteSubtasks } = input;
    const dependencies = requireTaskDeleteDependencies(
      devServerService,
      gitPort,
      settingsConfig,
      workspaceSettingsService,
    );
    const currentTasks = await taskStore.listTasks({ repoPath });
    const current = currentTasks.find((task) => task.id === taskId);
    if (!current) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const directSubtaskIds = currentTasks
      .filter((task) => task.parentId === taskId)
      .map((task) => task.id);
    if (directSubtaskIds.length > 0 && !deleteSubtasks) {
      throw new Error(
        `Task ${taskId} has ${directSubtaskIds.length} subtasks. Confirm subtask deletion to continue.`,
      );
    }

    const targetTasks = collectTaskDeleteTargets(currentTasks, taskId, deleteSubtasks);
    const targetTaskIds = targetTasks.map((task) => task.id);
    if (targetTasks.some(taskHasImplementationSessions)) {
      if (!taskActivityGuard) {
        throw new Error(
          "task_delete requires runtime session activity checks for tasks with build or QA sessions.",
        );
      }
      await taskActivityGuard.ensureNoActiveTaskDeleteRuns({
        repoPath,
        taskIds: targetTaskIds,
        tasks: targetTasks,
      });
    }

    const repoConfig =
      await dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
    const effectiveRepoPath = repoConfig.repoPath;
    const branchPrefix = repoConfig.branchPrefix.trim() || DEFAULT_BRANCH_PREFIX;
    const worktreePaths = await collectDeleteWorktreePaths(
      dependencies,
      effectiveRepoPath,
      branchPrefix,
      targetTasks,
    );
    const branchNames = await collectRelatedTaskBranches(
      dependencies.gitPort,
      effectiveRepoPath,
      branchPrefix,
      targetTaskIds,
    );
    const removedWorktrees: string[] = [];
    const deletedBranches: string[] = [];

    try {
      for (const targetTaskId of targetTaskIds) {
        await dependencies.devServerService.stop({
          repoPath: effectiveRepoPath,
          taskId: targetTaskId,
        });
      }
      for (const worktreePath of worktreePaths) {
        await dependencies.gitPort.removeWorktree(effectiveRepoPath, worktreePath, true);
        removedWorktrees.push(worktreePath);
      }
      for (const branchName of branchNames) {
        await dependencies.gitPort.deleteLocalBranch(effectiveRepoPath, branchName, true);
        deletedBranches.push(branchName);
      }
      await taskStore.deleteTask({
        repoPath: effectiveRepoPath,
        taskId,
        deleteSubtasks,
      });
    } catch (error) {
      throw appendDeleteCleanupProgress(error, removedWorktrees, deletedBranches);
    }

    return { ok: true };
  },
});
