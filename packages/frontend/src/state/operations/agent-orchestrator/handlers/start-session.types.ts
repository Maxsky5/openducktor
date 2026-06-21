import type {
  AgentSessionRecord,
  RepoPromptOverrides,
  TaskCard,
  TaskWorktreeSummary,
} from "@openducktor/contracts";
import type { AgentEnginePort, AgentRole, AgentUserMessagePart } from "@openducktor/core";
import type { SessionStartGate } from "@/features/session-start/session-start-gate";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { StartAgentSessionInput, StartAgentSessionResult } from "@/types/agent-session-start";
import type { EnsureRuntime, RuntimeInfo, TaskDocuments } from "../runtime/runtime";
import type { LoadSourceSession } from "../session-read-model/source-session-loader";
import type { ObserveAgentSession } from "../support/session-runtime-ref";

export type { StartAgentSessionInput, StartAgentSessionResult };

export type SessionDependencies = {
  replaceSession: (session: AgentSessionState) => void;
  removeSession: (identity: AgentSessionIdentity) => void;
  readSessionSnapshot: (identity: AgentSessionIdentity) => AgentSessionState | null;
  sessionStartGateRef: { current: SessionStartGate<StartAgentSessionResult> };
  loadSourceSession: LoadSourceSession;
  loadAgentSessionHistory: (session: AgentSessionIdentity) => Promise<AgentSessionState | null>;
  persistSessionRecord: (taskId: string, record: AgentSessionRecord) => Promise<void>;
  observeAgentSession: ObserveAgentSession;
};

export type RuntimeDependencies = {
  resolveTaskWorktree: (repoPath: string, taskId: string) => Promise<TaskWorktreeSummary | null>;
  adapter: AgentEnginePort;
  ensureRuntime: EnsureRuntime;
};

export type TaskDependencies = {
  taskRef: { current: TaskCard[] };
  loadTaskDocuments: (repoPath: string, taskId: string) => Promise<TaskDocuments>;
  refreshTaskData: (
    repoPath: string,
    taskIdOrIds?: string | string[],
    options?: { forceFreshTaskList?: boolean },
  ) => Promise<void>;
  sendAgentMessage: (session: AgentSessionIdentity, parts: AgentUserMessagePart[]) => Promise<void>;
};

export type ModelDependencies = {
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
};

export type RepoDependencies = {
  workspaceRepoPath: string | null;
  workspaceId: string | null;
  repoEpochRef: { current: number };
  currentWorkspaceRepoPathRef: { current: string | null };
};

export type StartSessionDependencies = {
  repo: RepoDependencies;
  session: SessionDependencies;
  runtime: RuntimeDependencies;
  task: TaskDependencies;
  model: ModelDependencies;
};

export type RepoStaleGuard = () => boolean;
export type SessionStartSummary = Awaited<ReturnType<AgentEnginePort["startSession"]>>;

export type SessionStartTags = {
  repoPath: string;
  taskId: string;
  role: AgentRole;
  externalSessionId: string;
};

export type StartSessionContext = {
  repoPath: string;
  workspaceId: string;
  taskId: string;
  role: AgentRole;
  holdForPostStartMessage: boolean;
  isStaleRepoOperation: RepoStaleGuard;
};

export type StartedSessionContext = StartSessionContext & {
  summary: SessionStartSummary;
};

export type StartSessionExecutionDependencies = Pick<
  StartSessionDependencies,
  "session" | "runtime" | "task" | "model"
>;

export type FreshStartRuntimeContext = {
  runtime: RuntimeInfo;
  systemPrompt: string;
};

export type StartOrReuseResult =
  | {
      kind: "reused";
      session: AgentSessionIdentity;
    }
  | {
      kind: "started";
      runtimeInfo: RuntimeInfo;
      taskCard: TaskCard;
      ctx: StartedSessionContext;
    };
