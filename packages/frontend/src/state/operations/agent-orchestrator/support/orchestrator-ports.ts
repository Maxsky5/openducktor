import type {
  AgentSessionRecord,
  AgentSessionStopTarget,
  TaskWorktreeSummary,
} from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import type { host } from "../../shared/host";

export type AgentOrchestratorHostPort = {
  agentSessionUpsert: (
    repoPath: string,
    taskId: string,
    record: AgentSessionRecord,
  ) => Promise<void>;
  agentSessionStop: (target: AgentSessionStopTarget) => Promise<void>;
  taskWorktreeGet: (repoPath: string, taskId: string) => Promise<TaskWorktreeSummary | null>;
};

export type AgentOrchestratorRuntimeHostPort = {
  taskSessionBootstrapPrepare: typeof host.taskSessionBootstrapPrepare;
  taskSessionBootstrapComplete: typeof host.taskSessionBootstrapComplete;
  taskSessionBootstrapAbort: typeof host.taskSessionBootstrapAbort;
};

export type AgentOrchestratorDependencies = {
  queryClient: QueryClient;
  hostPort: AgentOrchestratorHostPort;
  runtimeHostPort: AgentOrchestratorRuntimeHostPort;
};
