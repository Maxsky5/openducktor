import type {
  DirectMergeRecord,
  TaskCard,
  TaskDirectMergeCompleteIntent,
} from "@openducktor/contracts";
import { Cause, Effect } from "effect";
import {
  HostOperationError,
  errorMessage,
  toHostOperationError,
} from "../../../effect/host-errors";
import type { TaskServiceUseCaseInput } from "../task-service";
import type { TaskCompletionState } from "../task-completion-state";
import { createTaskMutationProgressFailure } from "../task-mutation-progress-failure";
import { completeTaskPublication } from "./complete-task-publication";
import type { requireMergedTaskCleanupDependencies } from "./required-task-dependencies";
import { cleanupDirectMergeTaskState } from "./task-worktree-cleanup";
import { enrichTask } from "./task-workflow-helpers";

/** Callers hold the task lifecycle guard and validate closure before entering this operation. */
export const closeMergedTask = (
  services: ReturnType<typeof requireMergedTaskCleanupDependencies> &
    Pick<TaskServiceUseCaseInput, "taskStore" | "completionState">,
  input: TaskDirectMergeCompleteIntent,
  merge: DirectMergeRecord,
  currentTasks: TaskCard[],
  state: TaskCompletionState,
  operation: "direct-merge" | "complete-direct-merge",
) =>
  Effect.uninterruptible(
    Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const { taskStore, completionState, gitPort } = services;
      const result = yield* Effect.exit(
        Effect.interruptible(
          Effect.gen(function* () {
            state.observation.phase = "publishing";
            delete state.observation.failure;
            yield* completionState.publish(state);
            yield* completeTaskPublication(gitPort, input, merge, state);
            state.observation.phase = "cleanup";
            yield* completionState.publish(state);
            if (!state.observation.cleanupCompleted) {
              yield* cleanupDirectMergeTaskState(
                services,
                taskStore,
                repoPath,
                taskId,
                merge,
                (branch) => {
                  state.deletedSourceBranch = branch;
                },
              );
              state.observation.cleanupCompleted = true;
            }
            const task = yield* Effect.uninterruptible(
              taskStore.transitionTask({ repoPath, taskId, status: "closed" }).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    state.observation.taskClosed = true;
                    delete state.deletedSourceBranch;
                  }),
                ),
              ),
            );
            state.observation.phase = "settled";
            yield* completionState.publish(state);
            return enrichTask(
              task,
              currentTasks.map((entry) => (entry.id === taskId ? task : entry)),
            );
          }),
        ),
      );
      if (result._tag === "Success") return result.value;

      let failure = toHostOperationError(Cause.squash(result.cause), `task.${operation}`);
      const stage = state.observation.cleanupCompleted ? "close_task" : state.observation.phase;
      if (state.deletedSourceBranch && !state.observation.taskClosed) {
        const branch = state.deletedSourceBranch;
        const restored = yield* Effect.result(gitPort.restoreDeletedBranch(repoPath, branch));
        delete state.observation.cleanupCompleted;
        if (restored._tag === "Failure") {
          failure = new HostOperationError({
            operation: "task.cleanup.restore-source",
            message: `${failure.message}\nTask completion failed and its source branch could not be restored: ${errorMessage(restored.failure)}. Restore ${branch.name} at ${branch.oid} before retrying completion.`,
            cause: restored.failure,
          });
        } else delete state.deletedSourceBranch;
      }
      state.observation.phase = "settled";
      state.observation.failure = {
        stage,
        code: "task_completion_failed",
        message: failure.message,
        nextAction:
          "Inspect the recorded effects and remaining step. Do not repeat the merge or uncertain publication.",
      };
      const published = yield* Effect.result(completionState.publish(state));
      if (published._tag === "Failure")
        failure = new HostOperationError({
          operation: `task.${operation}`,
          message: `${failure.message}\nCompletion observation could not be published: ${errorMessage(published.failure)}. Reconnect to read the retained result.`,
          cause: published.failure,
        });
      return yield* createTaskMutationProgressFailure(operation, taskId, failure);
    }),
  );
