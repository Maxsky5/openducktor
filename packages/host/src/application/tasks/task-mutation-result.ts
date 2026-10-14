import { Effect } from "effect";
import type {
  TaskService,
  TaskServiceError,
  TaskServiceWithMutationProgress,
} from "./task-service";
import type { TaskMutationProgressFailure } from "./task-mutation-progress-failure";

const discardTaskMutationProgress = <A>(
  effect: Effect.Effect<A, TaskServiceError | TaskMutationProgressFailure>,
): Effect.Effect<A, TaskServiceError> =>
  effect.pipe(
    Effect.catchTag("TaskMutationProgressFailure", (progressFailure) =>
      Effect.fail(progressFailure.failure),
    ),
  );

export const withoutTaskMutationProgress = (
  taskService: TaskServiceWithMutationProgress,
): TaskService => {
  return {
    ...taskService,
    buildCompleted: (input) => discardTaskMutationProgress(taskService.buildCompleted(input)),
    createTask: (input) => discardTaskMutationProgress(taskService.createTask(input)),
    deleteTask: (input) => discardTaskMutationProgress(taskService.deleteTask(input)),
    directMerge: (input) => discardTaskMutationProgress(taskService.directMerge(input)),
    completeDirectMerge: (input) =>
      discardTaskMutationProgress(taskService.completeDirectMerge(input)),
    linkMergedPullRequest: (input) =>
      discardTaskMutationProgress(taskService.linkMergedPullRequest(input)),
    resetImplementation: (input) =>
      discardTaskMutationProgress(taskService.resetImplementation(input)),
    resetTask: (input) => discardTaskMutationProgress(taskService.resetTask(input)),
    setPlan: (input) => discardTaskMutationProgress(taskService.setPlan(input)),
    setSpec: (input) => discardTaskMutationProgress(taskService.setSpec(input)),
    updateTask: (input) => discardTaskMutationProgress(taskService.updateTask(input)),
  };
};
