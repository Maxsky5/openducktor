import { applyEffect } from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskServiceWithMutationProgress } from "../task-service";

export const createTaskReviewUseCases = ({
  taskStore,
  taskWorkflows,
}: CreateTaskServiceInput): Pick<TaskServiceWithMutationProgress, "humanRequestChanges"> => ({
  humanRequestChanges(input) {
    return applyEffect(taskStore, taskWorkflows, input, "review.request_changes");
  },
});
