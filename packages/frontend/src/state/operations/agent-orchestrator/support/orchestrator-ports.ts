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
  buildStart: typeof host.buildStart;
  runtimeEnsure: typeof host.runtimeEnsure;
};

export type AgentOrchestratorDependencies = {
  queryClient: QueryClient;
  hostPort: AgentOrchestratorHostPort;
  runtimeHostPort: AgentOrchestratorRuntimeHostPort;
};
