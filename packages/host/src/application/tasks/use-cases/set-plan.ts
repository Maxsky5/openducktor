import type { TaskChangeSet } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  canSetPlan,
  isActiveOrReviewStatus,
  normalizePlanSubtasks,
  validateEpicSubtasksReplaceable,
  validatePlanSubtaskRules,
} from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";
import type { TaskStorePort } from "../../../ports/task-repository-ports";
import { replaceEpicPlanSubtasks } from "../support/planning-rules";
import type { SetPlanInput } from "../task-inputs";
import { TaskMutationProgressFailure } from "../task-mutation-progress-failure";
import type { TaskServiceError, TaskSetPlanResult } from "../task-service";

export type SetPlanUseCase = (
  input: SetPlanInput,
) => Effect.Effect<TaskSetPlanResult, TaskServiceError | TaskMutationProgressFailure>;

export const createSetPlanUseCase =
  (taskStore: TaskStorePort): SetPlanUseCase =>
  (input) =>
    Effect.gen(function* () {
      const { repoPath, taskId, markdown, hasExplicitSubtasks } = input;
      const subtaskCreates = normalizePlanSubtasks(input.subtasks);
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
      if (!canSetPlan(current)) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `set_plan is not allowed for issue type ${current.issueType} from status ${current.status}. feature/epic allow spec_ready/ready_for_dev/in_progress/blocked/ai_review/human_review; task/bug also allow open.`,
            details: { repoPath, taskId, issueType: current.issueType, status: current.status },
          }),
        );
      }

      const isActiveOrReview = isActiveOrReviewStatus(current.status);
      const shouldValidateSubtaskRules =
        current.issueType !== "epic" || !isActiveOrReview || hasExplicitSubtasks;
      const effectiveSubtaskCreates = current.issueType === "epic" ? subtaskCreates : [];
      if (shouldValidateSubtaskRules) {
        yield* Effect.try({
          try: () => validatePlanSubtaskRules(current, currentTasks, subtaskCreates),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
      }

      const shouldReplaceEpicSubtasks = current.issueType === "epic" && hasExplicitSubtasks;
      if (shouldReplaceEpicSubtasks) {
        yield* Effect.try({
          try: () => validateEpicSubtasksReplaceable(current, currentTasks),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
      }

      const document = yield* taskStore.setPlanDocument({ repoPath, taskId, markdown });
      let changes: TaskChangeSet = { taskIds: [taskId], removedTaskIds: [] };
      if (shouldReplaceEpicSubtasks) {
        const removedTaskIds = yield* replaceEpicPlanSubtasks(
          taskStore,
          repoPath,
          current,
          currentTasks,
          effectiveSubtaskCreates,
        );
        changes = { taskIds: [taskId, ...removedTaskIds], removedTaskIds };
      }

      if (current.status === "open" || current.status === "spec_ready") {
        const transition = yield* Effect.either(
          taskStore.transitionTask({ repoPath, taskId, status: "ready_for_dev" }),
        );
        if (transition._tag === "Left") {
          if (changes.removedTaskIds.length > 0) {
            return yield* Effect.fail(
              new TaskMutationProgressFailure({
                operation: "set-plan",
                changes,
                failure: transition.left,
              }),
            );
          }
          return yield* Effect.fail(transition.left);
        }
      }

      return { document, changes };
    });
