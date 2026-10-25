import { Effect } from "effect";
import { HostDependencyError, HostValidationError } from "../../../effect/host-errors";
import {
  requireBuildCompletedDependencies,
  requireDependencies,
} from "../support/required-task-dependencies";
import { requireEffectInput } from "../support/task-workflow-events";
import {
  applyEffect,
  blockBuildCompletionTask,
  buildCompletionWorktreePath,
  enrichTask,
} from "../support/task-workflow-helpers";
import { runHookCommandsAllowFailure } from "../support/workflow-hooks";
import { createTaskMutationProgressFailure } from "../task-mutation-progress-failure";
import type { CreateTaskServiceInput, TaskServiceWithMutationProgress } from "../task-service";

export const createTaskBuildStateUseCases = ({
  taskStore,
  taskWorkflows,
  gitPort,
  taskSessionLifecycleCoordinator,
  settingsConfig,
  systemCommands,
  workspaceSettingsService,
}: CreateTaskServiceInput): Pick<
  TaskServiceWithMutationProgress,
  "buildBlocked" | "buildResumed" | "buildCompleted"
> => ({
  buildBlocked(input) {
    return Effect.scoped(
      Effect.gen(function* () {
        const { repoPath, taskId, reason } = input;
        if (!reason.trim()) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "reason",
              message: "build_blocked requires a non-empty reason",
            }),
          );
        }
        if (!gitPort || !taskSessionLifecycleCoordinator) {
          return yield* Effect.fail(
            new HostDependencyError({
              dependency: !gitPort ? "gitPort" : "taskSessionLifecycleCoordinator",
              operation: "block build",
              message:
                "Git port and task session lifecycle coordinator are required to block a build.",
            }),
          );
        }
        const canonicalRepoPath = yield* gitPort.canonicalizePath(repoPath);
        yield* taskSessionLifecycleCoordinator.acquireLifecycle(
          canonicalRepoPath,
          [taskId],
          "block build",
        );
        return yield* applyEffect(
          taskStore,
          taskWorkflows.forRepo(repoPath),
          { repoPath, taskId },
          "build.blocked",
        );
      }),
    );
  },

  buildResumed(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      return yield* applyEffect(
        taskStore,
        taskWorkflows.forRepo(repoPath),
        { repoPath, taskId },
        "build.resumed",
      );
    });
  },

  buildCompleted(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const dependencies = yield* requireDependencies(() =>
        requireBuildCompletedDependencies(settingsConfig, systemCommands, workspaceSettingsService),
      );
      const current = yield* taskStore.getTask({ repoPath, taskId });
      const workflow = taskWorkflows.forRepo(repoPath);

      const decision = yield* requireEffectInput(
        "build_completed is",
        workflow,
        "build.completed",
        current,
        {
          repoPath,
          taskId,
          status: current.status,
        },
      );
      if (decision.kind === "unchanged") {
        return enrichTask(workflow, current);
      }

      const repoConfig =
        yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const nextStatus = decision.to;

      const postCompleteHooks = repoConfig.hooks.postComplete
        .map((hook) => hook.trim())
        .filter(Boolean);
      if (postCompleteHooks.length > 0) {
        const worktreePathResult = yield* Effect.result(
          buildCompletionWorktreePath(dependencies.settingsConfig, repoConfig, taskId),
        );
        if (worktreePathResult._tag === "Failure") {
          yield* blockBuildCompletionTask(taskStore, workflow, repoPath, taskId, current);
          return yield* Effect.fail(
            createTaskMutationProgressFailure(
              "build-completed",
              taskId,
              worktreePathResult.failure,
            ),
          );
        }
        const worktreePath = worktreePathResult.success;

        const failure = yield* runHookCommandsAllowFailure(
          dependencies.systemCommands,
          postCompleteHooks,
          worktreePath,
        );
        if (failure !== null) {
          const message = `Worktree cleanup script command failed: ${failure.hook}\n${failure.stderr}`;
          yield* blockBuildCompletionTask(taskStore, workflow, repoPath, taskId, current);
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

      const updated = yield* taskStore.transitionTask({
        repoPath,
        taskId,
        status: nextStatus,
        cause: decision.cause,
      });
      return enrichTask(workflow, updated);
    });
  },
});
