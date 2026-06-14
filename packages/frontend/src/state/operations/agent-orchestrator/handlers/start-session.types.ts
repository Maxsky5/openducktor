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
import type {
  AgentSessionCollection,
  AgentSessionCollectionUpdater,
} from "@/state/agent-session-collection";
import type { AgentSessionIdentity, AgentSessionRouteIdentity } from "@/types/agent-orchestrator";
import type { ActiveWorkspace, LoadAgentSessionsOptions } from "@/types/state-slices";
import type { EnsureRuntime, RuntimeInfo, TaskDocuments } from "../runtime/runtime";
import type { ListenToAgentSession } from "../support/session-runtime-ref";

export type StartAgentSessionInput =
  | {
      taskId: string;
      role: AgentRole;
      selectedModel?: never;
      startMode: "reuse";
      sourceExternalSessionId: string;
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
      sourceExternalSessionId: string;
    };

export type StartAgentSessionResult = AgentSessionRouteIdentity;

export type SessionDependencies = {
  setSessionCollection: (updater: AgentSessionCollectionUpdater) => void;
  sessionsRef: { current: AgentSessionCollection };
  inFlightStartsByWorkspaceTaskRef: { current: Map<string, Promise<StartAgentSessionResult>> };
  loadAgentSessions: (taskId: string, options?: LoadAgentSessionsOptions) => Promise<void>;
  persistSessionRecord: (taskId: string, record: AgentSessionRecord) => Promise<void>;
  listenToAgentSession: ListenToAgentSession;
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
  activeWorkspace: ActiveWorkspace | null;
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
  workingDirectory: string;
};

export type StartSessionExecutionDependencies = Pick<
  StartSessionDependencies,
  "session" | "runtime" | "task" | "model"
>;

export type StartSessionCreationInput =
  | {
      startMode: "reuse";
      selectedModel?: never;
      sourceExternalSessionId: string;
    }
  | {
      startMode: "fresh";
      selectedModel: AgentModelSelection;
      targetWorkingDirectory?: string | null;
    }
  | {
      startMode: "fork";
      selectedModel: AgentModelSelection;
      sourceExternalSessionId: string;
    };

export type ResolvedRuntimeAndModel = {
  taskCard: TaskCard;
  runtime: RuntimeInfo;
  systemPrompt: string;
  promptOverrides: RepoPromptOverrides;
};

export type StartOrReuseResult =
  | {
      kind: "reused";
      session: AgentSessionRouteIdentity;
    }
  | {
      kind: "started";
      runtimeInfo: RuntimeInfo;
      taskCard: TaskCard;
      ctx: StartedSessionContext;
    };
