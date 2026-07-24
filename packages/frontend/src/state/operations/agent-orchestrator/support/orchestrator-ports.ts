import type {
  AgentSessionIdentity,
  AgentSessionLiveEnvelope,
  AgentSessionRecord,
  TaskWorktreeSummary,
} from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import type { AgentSessionReadPort } from "@/state/queries/agent-sessions";
import type { host } from "../../shared/host";

export type AgentOrchestratorHostPort = AgentSessionReadPort & {
  agentSessionDelete: (
    repoPath: string,
    taskId: string,
    identity: AgentSessionIdentity,
  ) => Promise<void>;
  agentSessionUpsert: (
    repoPath: string,
    taskId: string,
    record: AgentSessionRecord,
  ) => Promise<void>;
  taskMetadataGetFresh: typeof host.taskMetadataGetFresh;
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

export type AgentOrchestratorLiveSessionHostPort = {
  agentSessionLiveLoadContext: typeof host.agentSessionLiveLoadContext;
  agentSessionLiveRead: typeof host.agentSessionLiveRead;
  agentSessionLiveReplyApproval: typeof host.agentSessionLiveReplyApproval;
  agentSessionLiveReplyQuestion: typeof host.agentSessionLiveReplyQuestion;
  observeAgentSessionLive: (
    input: { repoPath: string },
    listener: (envelope: AgentSessionLiveEnvelope) => void,
  ) => Promise<() => void>;
};

export type AgentOrchestratorDependencies = {
  queryClient: QueryClient;
  hostPort: AgentOrchestratorHostPort;
  runtimeHostPort: AgentOrchestratorRuntimeHostPort;
  liveSessionHostPort: AgentOrchestratorLiveSessionHostPort;
};
