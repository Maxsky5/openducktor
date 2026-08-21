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

type TaskActivityGuardTaskSessions = {
  repoPath: string;
  taskSessions: Array<{
    taskId: string;
    sessions: AgentSessionRecord[];
  }>;
};

// Callers pre-filter sessions to the set the mutation would act on; the
// adapter probes and stops exactly what it receives.
export type TaskActivityGuardPort = {
  countLiveSessions(
    input: TaskActivityGuardTaskSessions,
  ): Effect.Effect<{ liveSessionCount: number }, TaskActivityGuardError>;
  stopLiveSessions(
    input: TaskActivityGuardTaskSessions,
  ): Effect.Effect<TaskActivityGuardStopResult, TaskActivityGuardError>;
};
