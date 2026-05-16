import type { TaskCard } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostOperationError, HostValidationError } from "../effect/host-errors";

export type TaskActivityGuardError = HostOperationError | HostValidationError;

export type TaskActivityGuardPort = {
  ensureNoActiveTaskDeleteRuns(input: {
    repoPath: string;
    taskIds: string[];
    tasks: TaskCard[];
  }): Effect.Effect<void, TaskActivityGuardError>;
  ensureNoActiveTaskResetActivity(input: {
    repoPath: string;
    taskId: string;
    sessions: NonNullable<TaskCard["agentSessions"]>;
    operationLabel: string;
    sessionRoles: string[];
  }): Effect.Effect<void, TaskActivityGuardError>;
};
