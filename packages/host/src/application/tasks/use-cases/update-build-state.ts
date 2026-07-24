import { Effect } from "effect";
import { HostValidationError } from "../../../effect/host-errors";
import {
  requireBuildCompletedDependencies,
  requireDependencies,
} from "../support/required-task-dependencies";
import { validateTaskTransitionEffect } from "../support/task-validation-effects";
import {
  blockBuildCompletionTask,
  buildCompletionWorktreePath,
  enrichTask,
  taskListWithCurrent,
} from "../support/task-workflow-helpers";
import { runHookCommandsAllowFailure } from "../support/workflow-hooks";
import { createTaskMutationProgressFailure } from "../task-mutation-progress-failure";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskBuildStateUseCases = ({
  taskStore,
  settingsConfig,
  systemCommands,
  workspaceSettingsService,
}: CreateTaskServiceInput) => ({
  buildBlocked(input: Parameters<TaskService["buildBlocked"]>[0]) {
    return Effect.gen(function* () {
      const { repoPath, taskId, reason } = input;
      if (!reason.trim()) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "reason",
            message: "build_blocked requires a non-empty reason",
          }),
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
      yield* validateTaskTransitionEffect(current, currentTasks, current.status, "blocked");

      if (current.status === "blocked") {
        return enrichTask(current, currentTasks);
      }

      const updated = yield* taskStore.transitionTask({ repoPath, taskId, status: "blocked" });
      const nextTasks = currentTasks.map((task) => (task.id === taskId ? updated : task));

      return enrichTask(updated, nextTasks);
    });
  },

  buildResumed(input: Parameters<TaskService["buildResumed"]>[0]) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const current = yield* taskStore.getTask({ repoPath, taskId });
      yield* validateTaskTransitionEffect(current, [current], current.status, "in_progress");

      if (current.status === "in_progress") {
        return enrichTask(current, [current]);
      }

      const updated = yield* taskStore.transitionTask({ repoPath, taskId, status: "in_progress" });
      return enrichTask(updated, [updated]);
    });
  },

  buildCompleted(input: Parameters<TaskService["buildCompleted"]>[0]) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const dependencies = yield* requireDependencies(() =>
        requireBuildCompletedDependencies(settingsConfig, systemCommands, workspaceSettingsService),
      );
      const { current, currentTasks } = yield* taskListWithCurrent(taskStore, repoPath, taskId);

      if (current.status === "ai_review" || current.status === "human_review") {
        return enrichTask(current, currentTasks);
      }
      if (current.status !== "in_progress" && current.status !== "blocked") {
        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `build_completed is only allowed from in_progress, blocked, ai_review, or human_review. Task ${current.id} is ${current.status}.`,
            details: { repoPath, taskId, status: current.status },
          }),
        );
      }

      const repoConfig =
        yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const nextStatus =
        current.aiReviewEnabled && current.documentSummary.qaReport.verdict !== "approved"
          ? "ai_review"
          : "human_review";
      yield* validateTaskTransitionEffect(current, currentTasks, current.status, nextStatus);

      const postCompleteHooks = repoConfig.hooks.postComplete
        .map((hook) => hook.trim())
        .filter(Boolean);
      if (postCompleteHooks.length > 0) {
        const worktreePathResult = yield* Effect.either(
          buildCompletionWorktreePath(dependencies.settingsConfig, repoConfig, taskId),
        );
        if (worktreePathResult._tag === "Left") {
          yield* blockBuildCompletionTask(taskStore, repoPath, taskId, current, currentTasks);
          return yield* Effect.fail(
            createTaskMutationProgressFailure("build-completed", taskId, worktreePathResult.left),
          );
        }
        const worktreePath = worktreePathResult.right;

        const failure = yield* runHookCommandsAllowFailure(
          dependencies.systemCommands,
          postCompleteHooks,
          worktreePath,
        );
        if (failure !== null) {
          const message = `Worktree cleanup script command failed: ${failure.hook}\n${failure.stderr}`;
          yield* blockBuildCompletionTask(taskStore, repoPath, taskId, current, currentTasks);
          return yield* Effect.fail(
            createTaskMutationProgressFailure(
              "build-completed",
              taskId,
              new HostValidationError({
                field: "taskId",
                message,
                details: { repoPath, taskId, hook: failure.hook },
              }),
            ),
          );
        }
      }

      const updated = yield* taskStore.transitionTask({ repoPath, taskId, status: nextStatus });
      const nextTasks = currentTasks.map((task) => (task.id === taskId ? updated : task));

      return enrichTask(updated, nextTasks);
    });
  },
});
