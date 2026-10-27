import type { DirectMergeRecord, TaskDirectMergeCompleteIntent } from "@openducktor/contracts";
import type { TaskWorkflow } from "@openducktor/workflows";
import { Cause, Effect } from "effect";
import {
  HostOperationError,
  errorMessage,
  toHostOperationError,
} from "../../../effect/host-errors";
import type { TaskActivityGuardPort } from "../../../ports/task-activity-guard-port";
import type { TaskRecord } from "../../../ports/task-repository-ports";
import type { TaskServiceUseCaseInput } from "../task-service";
import type { TaskCompletionState } from "../task-completion-state";
import { createTaskMutationProgressFailure } from "../task-mutation-progress-failure";
import { completeTaskPublication } from "./complete-task-publication";
import type { requireMergedTaskCleanupDependencies } from "./required-task-dependencies";
import { cleanupConfirmedMergeClose } from "./task-close-cleanup";
import { enrichTask } from "./task-workflow-helpers";
import { decisionTransition, type AdmittedTaskEvent } from "./task-workflow-events";

/** Callers hold the task lifecycle guard and validate closure before entering this operation. */
export const closeMergedTask = (
  services: ReturnType<typeof requireMergedTaskCleanupDependencies> &
    Pick<
      TaskServiceUseCaseInput,
      "taskStore" | "completionState" | "taskSessionLifecycleCoordinator"
    > & { taskActivityGuard: TaskActivityGuardPort | undefined; workflow: TaskWorkflow },
  input: TaskDirectMergeCompleteIntent,
  merge: DirectMergeRecord,
  current: TaskRecord,
  state: TaskCompletionState,
  decision: AdmittedTaskEvent,
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
            // A cleanup that kept the worktree runs again when a retry removes it.
            const needsCleanup =
              state.observation.cleanupCompleted !== true ||
              (input.removeWorktree && state.keptWorktree === true);
            if (needsCleanup) {
              yield* cleanupConfirmedMergeClose({
                dependencies: services,
                taskStore,
                lifecycle: services.taskSessionLifecycleCoordinator,
                repoPath,
                workflow: services.workflow,
                task: current,
                // Direct merge requires a clean worktree, so a dirty one fails the close.
                worktreeCleanup: { remove: input.removeWorktree, force: false },
                onBranchDeleting: (branch) => {
                  state.deletedBranches = [...(state.deletedBranches ?? []), branch];
                },
              });
              state.observation.cleanupCompleted = true;
              if (input.removeWorktree) delete state.keptWorktree;
              else state.keptWorktree = true;
            }
            const task = yield* Effect.uninterruptible(
              taskStore.transitionTask({ repoPath, taskId, ...decisionTransition(decision) }).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    state.observation.taskClosed = true;
                    delete state.deletedBranches;
                  }),
                ),
              ),
            );
            state.observation.phase = "settled";
            yield* completionState.publish(state);
            return enrichTask(services.workflow, task);
          }),
        ),
      );
      if (result._tag === "Success") return result.value;

      let failure = toHostOperationError(Cause.squash(result.cause), `task.${operation}`);
      const stage = state.observation.cleanupCompleted ? "close_task" : state.observation.phase;
      if (state.deletedBranches && !state.observation.taskClosed) {
        const unrestored: { name: string; oid: string; cause: unknown }[] = [];
        for (const branch of state.deletedBranches) {
          const restored = yield* Effect.result(gitPort.restoreDeletedBranch(repoPath, branch));
          if (restored._tag === "Failure") unrestored.push({ ...branch, cause: restored.failure });
        }
        delete state.observation.cleanupCompleted;
        delete state.keptWorktree;
        const [firstUnrestored] = unrestored;
        if (firstUnrestored) {
          const branches = unrestored
            .map((branch) => `${branch.name} at ${branch.oid} (${errorMessage(branch.cause)})`)
            .join(", ");
          failure = new HostOperationError({
            operation: "task.cleanup.restore-source",
            message: `${failure.message}\nTask completion failed and its local branches could not be restored: ${branches}. Restore them before retrying completion.`,
            cause: firstUnrestored.cause,
          });
          state.deletedBranches = unrestored.map(({ name, oid }) => ({ name, oid }));
        } else delete state.deletedBranches;
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
