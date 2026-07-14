import { Effect } from "effect";
import { deriveAgentWorkflows } from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";
import { requireDependencies } from "../support/required-task-dependencies";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskSessionStartupLeaseUseCase = ({
  gitPort,
  taskStore,
  taskSessionBootstrapCoordinator: coordinator,
}: CreateTaskServiceInput): Pick<
  TaskService,
  | "taskSessionStartupLeasePrepare"
  | "taskSessionStartupLeaseComplete"
  | "taskSessionStartupLeaseAbort"
> => {
  if (!coordinator) throw new Error("Task session startup lease coordinator is required.");
  const finalize = (
    input: { repoPath: string; taskId: string; leaseId: string },
    outcome: "aborted" | "completed",
  ) =>
    Effect.gen(function* () {
      const git = yield* requireDependencies(() => {
        if (!gitPort) throw new Error("Git port is required for task session startup leases.");
        return gitPort;
      });
      const canonicalRepoPath = yield* git.canonicalizePath(input.repoPath);
      yield* coordinator.finishBootstrap(canonicalRepoPath, input.taskId, input.leaseId, outcome);
      return true;
    });
  return {
    taskSessionStartupLeasePrepare(input) {
      return Effect.gen(function* () {
        const git = yield* requireDependencies(() => {
          if (!gitPort) throw new Error("Git port is required for task session startup leases.");
          return gitPort;
        });
        const canonicalRepoPath = yield* git.canonicalizePath(input.repoPath);
        const task = yield* taskStore.getTask({
          repoPath: canonicalRepoPath,
          taskId: input.taskId,
        });
        const workflows = deriveAgentWorkflows(task);
        const workflow = input.role === "build" ? workflows.builder : workflows[input.role];
        if (!workflow.available) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "role",
              message: `${input.role} workflow is not available for task ${input.taskId}.`,
              details: {
                repoPath: canonicalRepoPath,
                taskId: input.taskId,
                role: input.role,
                status: task.status,
              },
            }),
          );
        }
        const leaseId = crypto.randomUUID();
        yield* coordinator.acquireBootstrap(canonicalRepoPath, input.taskId, leaseId, input.role);
        return leaseId;
      });
    },
    taskSessionStartupLeaseComplete: (input) => finalize(input, "completed"),
    taskSessionStartupLeaseAbort: (input) => finalize(input, "aborted"),
  };
};
