import { Cause, Effect } from "effect";
import { canonicalTargetBranch, directMergeConflict } from "../../../domain/task";
import {
  HostOperationError,
  causeToHostBoundaryError,
  errorMessage,
  toHostOperationError,
} from "../../../effect/host-errors";
import type { GitMergeBranchRequest } from "../../../ports/git-port";
import { prepareDirectMerge } from "../support/approval-readiness";
import { enrichTask } from "../support/task-workflow-helpers";
import { closeMergedTask } from "../support/close-merged-task";
import {
  TaskMutationProgressFailure,
  createTaskMutationProgressFailure,
} from "../task-mutation-progress-failure";
import type { TaskServiceUseCaseInput, TaskService } from "../task-service";

export const createTaskDirectMergeUseCase = (services: TaskServiceUseCaseInput) => ({
  directMerge(input: Parameters<TaskService["directMerge"]>[0]) {
    return Effect.gen(function* () {
      const { taskStore, completionState, taskActivityGuard, taskSessionLifecycleCoordinator } =
        services;
      const { taskId, input: mergeInput } = input;
      const { dependencies, effectiveRepoPath, current, currentTasks, approval, state } =
        yield* prepareDirectMerge(services, input);
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          if (!state.merge) {
            const request: GitMergeBranchRequest = {
              sourceBranch: approval.sourceBranch,
              targetBranch: canonicalTargetBranch(approval.targetBranch),
              method: mergeInput.mergeMethod,
              sourceWorkingDirectory: approval.workingDirectory,
              onWorkIssued: () => {
                state.mergeUncertain = true;
              },
              onApplied: (oid) => {
                state.appliedTargetOid = oid;
              },
            };
            if (mergeInput.squashCommitMessage !== undefined)
              request.squashCommitMessage = mergeInput.squashCommitMessage;
            const result = yield* Effect.exit(
              restore(dependencies.gitPort.mergeBranch(effectiveRepoPath, request)),
            );
            if (result._tag === "Failure") {
              if (!state.mergeUncertain)
                return yield* Effect.fail(causeToHostBoundaryError(result.cause));
              state.observation.failure = {
                stage: "merge",
                code: "merge_result_unknown",
                message: "Git returned no conclusive merge result.",
                nextAction:
                  "Inspect the original target branch and Git state. Do not apply another merge while its result is uncertain.",
              };
              yield* completionState.publish(state);
              return yield* new HostOperationError({
                operation: "task.direct-merge",
                message: state.observation.failure.nextAction,
                cause: result.cause,
              });
            }
            delete state.mergeUncertain;
            if (result.value.outcome === "conflicts")
              return {
                outcome: "conflicts" as const,
                conflict: directMergeConflict(
                  effectiveRepoPath,
                  approval,
                  mergeInput.mergeMethod,
                  result.value.conflictedFiles,
                  result.value.output,
                ),
              };
            state.merge = {
              method: mergeInput.mergeMethod,
              sourceBranch: approval.sourceBranch,
              targetBranch: approval.targetBranch,
              mergedAt: new Date().toISOString(),
            };
          }
          const directMerge = state.merge;
          let stage = "record_merge";
          const completed = yield* Effect.exit(
            Effect.gen(function* () {
              state.observation.phase = "settled";
              yield* taskStore.setDirectMerge({ repoPath: effectiveRepoPath, taskId, directMerge });
              delete state.observation.failure;
              stage = "publish";
              yield* completionState.publish(state);
              if (!approval.publishTarget) {
                const task = yield* closeMergedTask(
                  {
                    ...dependencies,
                    taskStore,
                    completionState,
                    taskActivityGuard,
                    taskSessionLifecycleCoordinator,
                  },
                  { repoPath: effectiveRepoPath, taskId },
                  directMerge,
                  currentTasks,
                  state,
                  "direct-merge",
                );
                return { outcome: "completed" as const, task };
              }
              // A recorded remote merge waits for a separate explicit publication intent.
              stage = "review_task";
              const task =
                current.status === "ai_review"
                  ? yield* taskStore.transitionTask({
                      repoPath: effectiveRepoPath,
                      taskId,
                      status: "human_review",
                    })
                  : current;
              return {
                outcome: "completed" as const,
                task: enrichTask(
                  task,
                  currentTasks.map((entry) => (entry.id === taskId ? task : entry)),
                ),
              };
            }),
          );
          if (completed._tag === "Success") return completed.value;
          const cause = Cause.squash(completed.cause);
          if (cause instanceof TaskMutationProgressFailure) return yield* cause;
          let failure = toHostOperationError(cause, "task.direct-merge.complete");
          state.observation.failure = {
            stage,
            code:
              stage === "record_merge"
                ? "merge_applied_record_failed"
                : "merge_applied_completion_failed",
            message: failure.message,
            nextAction:
              stage === "record_merge"
                ? "The merge already applied. Review its original target and retry record persistence. Do not apply another merge."
                : "The merge is recorded. Inspect the remaining step before continuing. Do not apply another merge.",
          };
          const published = yield* Effect.result(completionState.publish(state));
          if (published._tag === "Failure")
            failure = new HostOperationError({
              operation: "task.direct-merge.complete",
              message: `${failure.message}\nCompletion observation could not be published: ${errorMessage(published.failure)}. Reconnect to read the retained result.`,
              cause: published.failure,
            });
          return yield* createTaskMutationProgressFailure("direct-merge", taskId, failure);
        }),
      );
    }).pipe(Effect.scoped);
  },
});
