import { validateTransition } from "../../../domain/task";
import { enrichTask, recordQaOutcome, taskListWithCurrent } from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskReviewUseCases = ({
  taskStore,
}: CreateTaskServiceInput): Pick<
  TaskService,
  "qaApproved" | "qaRejected" | "humanRequestChanges" | "humanApprove"
> => ({
  async qaApproved(input) {
    const { repoPath, taskId, markdown } = input;

    return recordQaOutcome(taskStore, {
      repoPath,
      taskId,
      markdown,
      verdict: "approved",
      targetStatus: "human_review",
    });
  },

  async qaRejected(input) {
    const { repoPath, taskId, markdown } = input;

    return recordQaOutcome(taskStore, {
      repoPath,
      taskId,
      markdown,
      verdict: "rejected",
      targetStatus: "in_progress",
    });
  },

  async humanRequestChanges(input) {
    const { repoPath, taskId } = input;
    const metadata = await taskStore.getTaskMetadata({ repoPath, taskId });
    if (metadata.directMerge !== undefined) {
      throw new Error(
        `Cannot request changes after a local direct merge has already been applied for task ${taskId}. Push and complete the direct merge workflow first, or manually revert the local merge before reopening the task.`,
      );
    }

    const current = await taskStore.getTask({ repoPath, taskId });
    validateTransition(current, [current], current.status, "in_progress");

    if (current.status === "in_progress") {
      return enrichTask(current, [current]);
    }

    const updated = await taskStore.transitionTask({ repoPath, taskId, status: "in_progress" });
    return enrichTask(updated, [updated]);
  },

  async humanApprove(input) {
    const { repoPath, taskId } = input;
    const { current, currentTasks } = await taskListWithCurrent(taskStore, repoPath, taskId);
    validateTransition(current, currentTasks, current.status, "closed");

    if (current.status === "closed") {
      return enrichTask(current, currentTasks);
    }

    const updated = await taskStore.transitionTask({ repoPath, taskId, status: "closed" });
    const nextTasks = currentTasks.map((task) => (task.id === taskId ? updated : task));

    return enrichTask(updated, nextTasks);
  },
});
