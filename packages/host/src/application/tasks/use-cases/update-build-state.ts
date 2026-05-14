import { validateTransition } from "../../../domain/task";
import { requireBuildCompletedDependencies } from "../support/required-task-dependencies";
import {
  blockBuildCompletionTask,
  buildCompletionWorktreePath,
  enrichTask,
  taskListWithCurrent,
} from "../support/task-workflow-helpers";
import { runHookCommandsAllowFailure } from "../support/workflow-hooks";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskBuildStateUseCases = ({
  taskStore,
  settingsConfig,
  systemCommands,
  workspaceSettingsService,
}: CreateTaskServiceInput): Pick<
  TaskService,
  "buildBlocked" | "buildResumed" | "buildCompleted"
> => ({
  async buildBlocked(input) {
    const { repoPath, taskId, reason } = input;
    if (!reason.trim()) {
      throw new Error("build_blocked requires a non-empty reason");
    }
    const currentTasks = await taskStore.listTasks({ repoPath });
    const current = currentTasks.find((task) => task.id === taskId);
    if (!current) {
      throw new Error(`Task not found: ${taskId}`);
    }
    validateTransition(current, currentTasks, current.status, "blocked");

    if (current.status === "blocked") {
      return enrichTask(current, currentTasks);
    }

    const updated = await taskStore.transitionTask({ repoPath, taskId, status: "blocked" });
    const nextTasks = currentTasks.map((task) => (task.id === taskId ? updated : task));

    return enrichTask(updated, nextTasks);
  },

  async buildResumed(input) {
    const { repoPath, taskId } = input;
    const current = await taskStore.getTask({ repoPath, taskId });
    validateTransition(current, [current], current.status, "in_progress");

    if (current.status === "in_progress") {
      return enrichTask(current, [current]);
    }

    const updated = await taskStore.transitionTask({ repoPath, taskId, status: "in_progress" });
    return enrichTask(updated, [updated]);
  },

  async buildCompleted(input) {
    const { repoPath, taskId } = input;
    const dependencies = requireBuildCompletedDependencies(
      settingsConfig,
      systemCommands,
      workspaceSettingsService,
    );
    const { current, currentTasks } = await taskListWithCurrent(taskStore, repoPath, taskId);

    if (current.status === "ai_review" || current.status === "human_review") {
      return enrichTask(current, currentTasks);
    }
    if (current.status !== "in_progress" && current.status !== "blocked") {
      throw new Error(
        `build_completed is only allowed from in_progress, blocked, ai_review, or human_review. Task ${current.id} is ${current.status}.`,
      );
    }

    const repoConfig =
      await dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
    const nextStatus =
      current.aiReviewEnabled && current.documentSummary.qaReport.verdict !== "approved"
        ? "ai_review"
        : "human_review";
    validateTransition(current, currentTasks, current.status, nextStatus);

    const postCompleteHooks = repoConfig.hooks.postComplete
      .map((hook) => hook.trim())
      .filter(Boolean);
    if (postCompleteHooks.length > 0) {
      let worktreePath: string;
      try {
        worktreePath = await buildCompletionWorktreePath(
          dependencies.settingsConfig,
          repoConfig,
          taskId,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await blockBuildCompletionTask(taskStore, repoPath, taskId, current, currentTasks);
        throw new Error(message, { cause: error });
      }

      const failure = await runHookCommandsAllowFailure(
        dependencies.systemCommands,
        postCompleteHooks,
        worktreePath,
      );
      if (failure !== null) {
        const message = `Worktree cleanup script command failed: ${failure.hook}\n${failure.stderr}`;
        await blockBuildCompletionTask(taskStore, repoPath, taskId, current, currentTasks);
        throw new Error(message);
      }
    }

    const updated = await taskStore.transitionTask({ repoPath, taskId, status: nextStatus });
    const nextTasks = currentTasks.map((task) => (task.id === taskId ? updated : task));

    return enrichTask(updated, nextTasks);
  },
});
