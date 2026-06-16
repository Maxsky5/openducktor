import type {
  AgentSessionRecord,
  RepoPromptOverrides,
  TaskCard,
  TaskWorktreeSummary,
} from "@openducktor/contracts";
import type {
  AgentEnginePort,
  AgentModelSelection,
  AgentRole,
  AgentUserMessagePart,
} from "@openducktor/core";
import type { SessionStartGate } from "@/features/session-start/session-start-gate";
import type { AgentSessionCollectionUpdater } from "@/state/agent-session-collection";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { EnsureRuntime, RuntimeInfo, TaskDocuments } from "../runtime/runtime";
import type { ObserveAgentSession } from "../support/session-runtime-ref";

export type StartAgentSessionInput =
  | {
      taskId: string;
      role: AgentRole;
      selectedModel?: never;
      startMode: "reuse";
      sourceSession: AgentSessionIdentity;
    }
  | {
      taskId: string;
      role: AgentRole;
      selectedModel: AgentModelSelection;
      startMode: "fresh";
      targetWorkingDirectory?: string | null;
    }
  | {
      taskId: string;
      role: AgentRole;
      selectedModel: AgentModelSelection;
      startMode: "fork";
      sourceSession: AgentSessionIdentity;
    };

export type StartAgentSessionResult = AgentSessionIdentity;

export type SessionDependencies = {
  setSessionCollection: (updater: AgentSessionCollectionUpdater) => void;
  readSessionSnapshot: (identity: AgentSessionIdentity) => AgentSessionState | null;
  sessionStartGateRef: { current: SessionStartGate<StartAgentSessionResult> };
  loadAgentSessions: (taskId: string) => Promise<void>;
  loadAgentSessionHistory: (session: AgentSessionIdentity) => Promise<unknown>;
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
  isStaleRepoOperation: RepoStaleGuard;
};

export type StartedSessionContext = StartSessionContext & {
  summary: SessionStartSummary;
};

export type StartSessionExecutionDependencies = Pick<
  StartSessionDependencies,
  "session" | "runtime" | "task" | "model"
>;

export type ResolvedRuntimeAndModel = {
  taskCard: TaskCard;
  runtime: RuntimeInfo;
  systemPrompt: string;
  promptOverrides: RepoPromptOverrides;
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
