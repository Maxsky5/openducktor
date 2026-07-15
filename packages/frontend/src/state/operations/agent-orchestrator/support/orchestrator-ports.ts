import type {
  AgentSessionIdentity,
  AgentSessionRecord,
  AgentSessionStopTarget,
  TaskWorktreeSummary,
} from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import type { host } from "../../shared/host";

export type AgentOrchestratorHostPort = {
  agentSessionDelete: (
    repoPath: string,
    taskId: string,
    identity: AgentSessionIdentity,
  ) => Promise<void>;
  agentSessionsList: (repoPath: string, taskId: string) => Promise<AgentSessionRecord[]>;
  agentSessionUpsert: (
    repoPath: string,
    taskId: string,
    record: AgentSessionRecord,
  ) => Promise<void>;
  agentSessionStop: (target: AgentSessionStopTarget) => Promise<void>;
  taskWorktreeGet: (repoPath: string, taskId: string) => Promise<TaskWorktreeSummary | null>;
};

export type AgentOrchestratorRuntimeHostPort = {
  gitCanonicalizePath: typeof host.gitCanonicalizePath;
  runtimeEnsure: typeof host.runtimeEnsure;
  taskSessionBootstrapPrepare: typeof host.taskSessionBootstrapPrepare;
  taskSessionBootstrapComplete: typeof host.taskSessionBootstrapComplete;
  taskSessionBootstrapAbort: typeof host.taskSessionBootstrapAbort;
  taskSessionStartupLeasePrepare: typeof host.taskSessionStartupLeasePrepare;
  taskSessionStartupLeaseComplete: typeof host.taskSessionStartupLeaseComplete;
  taskSessionStartupLeaseAbort: typeof host.taskSessionStartupLeaseAbort;
};

export type AgentOrchestratorDependencies = {
  queryClient: QueryClient;
  hostPort: AgentOrchestratorHostPort;
  runtimeHostPort: AgentOrchestratorRuntimeHostPort;
};
