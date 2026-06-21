import type { AgentSessionRecord } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostOperationError, HostValidationError } from "../effect/host-errors";

export type TaskActivityGuardError = HostOperationError | HostValidationError;

export type TaskActivityGuardPort = {
  ensureNoActiveTaskDeleteRuns(input: {
    repoPath: string;
    taskSessions: Array<{
      taskId: string;
      sessions: AgentSessionRecord[];
    }>;
  }): Effect.Effect<void, TaskActivityGuardError>;
  ensureNoActiveTaskResetActivity(input: {
    repoPath: string;
    taskId: string;
    sessions: AgentSessionRecord[];
    operationLabel: string;
    sessionRoles: string[];
  }): Effect.Effect<void, TaskActivityGuardError>;
};
