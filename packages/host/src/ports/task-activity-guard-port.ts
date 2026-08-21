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

export type TaskActivityGuardPort = {
  stopActiveTaskDeleteRuns(input: {
    repoPath: string;
    taskSessions: Array<{
      taskId: string;
      sessions: AgentSessionRecord[];
    }>;
  }): Effect.Effect<TaskActivityGuardStopResult, TaskActivityGuardError>;
  stopActiveTaskResetActivity(input: {
    repoPath: string;
    taskId: string;
    sessions: AgentSessionRecord[];
    operationLabel: string;
    sessionRoles: string[];
  }): Effect.Effect<TaskActivityGuardStopResult, TaskActivityGuardError>;
};
