import { Effect } from "effect";
import { HostValidationError } from "../../../effect/host-errors";
import { requireDependencies } from "../support/required-task-dependencies";
import { validateTaskSessionWorkflowAvailable } from "../support/task-session-workflow-validation";
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
      const current = yield* coordinator.inspectBootstrap(
        canonicalRepoPath,
        input.taskId,
        input.leaseId,
      );
      if (current.state === "terminal") {
        if (current.terminal.outcome !== outcome) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "leaseId",
              message: `Task session startup lease was already finalized as ${current.terminal.outcome}.`,
              details: {
                repoPath: canonicalRepoPath,
                taskId: input.taskId,
                leaseId: input.leaseId,
                requestedOutcome: outcome,
              },
            }),
          );
        }
        return true;
      }
      if (outcome === "completed") {
        const task = yield* taskStore.getTask({
          repoPath: canonicalRepoPath,
          taskId: input.taskId,
        });
        yield* validateTaskSessionWorkflowAvailable(task, current.role, canonicalRepoPath);
      }
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
        yield* validateTaskSessionWorkflowAvailable(task, input.role, canonicalRepoPath);
        const leaseId = crypto.randomUUID();
        yield* coordinator.acquireBootstrap(canonicalRepoPath, input.taskId, leaseId, input.role);
        return leaseId;
      });
    },
    taskSessionStartupLeaseComplete: (input) => finalize(input, "completed"),
    taskSessionStartupLeaseAbort: (input) => finalize(input, "aborted"),
  };
};
