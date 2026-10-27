import { Effect } from "effect";
import { ensureNoDirectMergeEffect } from "../support/direct-merge-block";
import { applyEffect } from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskServiceWithMutationProgress } from "../task-service";

export const createTaskReviewUseCases = ({
  taskStore,
  taskWorkflows,
}: CreateTaskServiceInput): Pick<TaskServiceWithMutationProgress, "humanRequestChanges"> => ({
  humanRequestChanges(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const metadata = yield* taskStore.getTaskMetadata({ repoPath, taskId });
      yield* ensureNoDirectMergeEffect({
        operation: "human_request_changes",
        repoPath,
        taskId,
        directMerge: metadata.directMerge,
      });

      return yield* applyEffect(
        taskStore,
        taskWorkflows,
        { repoPath, taskId },
        "review.request_changes",
      );
    });
  },
});
