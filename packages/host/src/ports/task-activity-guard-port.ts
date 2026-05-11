import type { TaskCard } from "@openducktor/contracts";

export type TaskActivityGuardPort = {
  ensureNoActiveTaskDeleteRuns(input: {
    repoPath: string;
    taskIds: string[];
    tasks: TaskCard[];
  }): Promise<void>;
  ensureNoActiveTaskResetActivity(input: {
    repoPath: string;
    taskId: string;
    sessions: NonNullable<TaskCard["agentSessions"]>;
    operationLabel: string;
    sessionRoles: string[];
  }): Promise<void>;
};
