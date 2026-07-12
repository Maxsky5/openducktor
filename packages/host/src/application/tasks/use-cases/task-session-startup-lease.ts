import { Effect } from "effect";
import { HostValidationError } from "../../../effect/host-errors";
import { requireDependencies } from "../support/required-task-dependencies";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskSessionStartupLeaseUseCase = ({
  gitPort,
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
      const terminal = coordinator.terminalOutcome(input.leaseId);
      if (terminal) {
        if (terminal.repoPath === canonicalRepoPath && terminal.taskId === input.taskId)
          return true;
        return yield* Effect.fail(
          new HostValidationError({
            field: "leaseId",
            message: `Unknown or mismatched task session startup lease for task ${input.taskId}.`,
          }),
        );
      }
      if (!coordinator.ownsBootstrap(canonicalRepoPath, input.taskId, input.leaseId)) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "leaseId",
            message: `Unknown or mismatched task session startup lease for task ${input.taskId}.`,
          }),
        );
      }
      coordinator.delete(canonicalRepoPath, input.taskId);
      coordinator.recordTerminal(input.leaseId, outcome, canonicalRepoPath, input.taskId);
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
        const leaseId = crypto.randomUUID();
        yield* coordinator.acquireBootstrap(canonicalRepoPath, input.taskId, leaseId, input.role);
        return leaseId;
      });
    },
    taskSessionStartupLeaseComplete: (input) => finalize(input, "completed"),
    taskSessionStartupLeaseAbort: (input) => finalize(input, "aborted"),
  };
};
