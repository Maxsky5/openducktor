import type { AgentSessionRecord } from "@openducktor/contracts";
import type { Effect } from "effect";
import type {
  HostOperationErrorAggregate,
  HostValidationErrorAggregate,
} from "../effect/host-errors";

export type TaskActivityGuardError = HostOperationErrorAggregate | HostValidationErrorAggregate;

export type TaskActivityGuardStopResult = {
  stoppedSessionCount: number;
};

// Callers choose the sessions. The adapter checks and stops only those sessions.
export type TaskActivityGuardTaskSessions = {
  repoPath: string;
  taskSessions: Array<{
    taskId: string;
    sessions: AgentSessionRecord[];
  }>;
};

export type TaskActivityGuardPort = {
  countLiveSessions(
    input: TaskActivityGuardTaskSessions,
  ): Effect.Effect<{ liveSessionCount: number }, TaskActivityGuardError>;
  cleanupTaskSessions(
    input: TaskActivityGuardTaskSessions,
  ): Effect.Effect<TaskActivityGuardStopResult, TaskActivityGuardError>;
};
