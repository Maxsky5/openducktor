import { Effect } from "effect";
import { HostDependencyError } from "../../../effect/host-errors";
import { decideEffectTransition, requireEffectInput } from "../support/task-workflow-events";
import { applyEffect, enrichTask } from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskServiceWithMutationProgress } from "../task-service";

export const createTaskBuildStateUseCases = ({
  taskStore,
  taskWorkflows,
  gitPort,
  taskSessionLifecycleCoordinator,
}: CreateTaskServiceInput): Pick<
  TaskServiceWithMutationProgress,
  "buildBlocked" | "buildResumed" | "buildCompleted"
> => ({
  buildBlocked(input) {
    return Effect.scoped(
      Effect.gen(function* () {
        const { repoPath, taskId } = input;
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
        return yield* applyEffect(taskStore, taskWorkflows, input, "build.blocked");
      }),
    );
  },

  buildResumed(input) {
    return applyEffect(taskStore, taskWorkflows, input, "build.resumed");
  },

  buildCompleted(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const current = yield* taskStore.getTask(input);
      const workflow = taskWorkflows.forTask(current);

      const decision = yield* requireEffectInput(
        "build-completed is",
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

      const updated = yield* taskStore.transitionTask({
        workspaceId: input.workspaceId,
        repoPath,
        taskId,
        decide: (task) =>
          decideEffectTransition(taskWorkflows.forTask(task), "build.completed", task),
      });
      return enrichTask(workflow, updated);
    });
  },
});
