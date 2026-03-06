import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type {
  AgentEnginePort,
  AgentModelSelection,
  AgentRole,
  AgentScenario,
} from "@openducktor/core";
import type { AgentSessionLoadOptions, AgentSessionState } from "@/types/agent-orchestrator";
import type { RuntimeInfo, TaskDocuments } from "../runtime/runtime";

export type StartAgentSessionInput = {
  taskId: string;
  role: AgentRole;
  scenario?: AgentScenario;
  selectedModel?: AgentModelSelection | null;
  sendKickoff?: boolean;
  startMode?: "reuse_latest" | "fresh";
  requireModelReady?: boolean;
  workingDirectoryOverride?: string | null;
};

export type SessionStateById = Record<string, AgentSessionState>;
export type SessionStateUpdater =
  | SessionStateById
  | ((current: SessionStateById) => SessionStateById);

export type SessionDependencies = {
  setSessionsById: (updater: SessionStateUpdater) => void;
  sessionsRef: { current: SessionStateById };
  inFlightStartsByRepoTaskRef: { current: Map<string, Promise<string>> };
  loadAgentSessions: (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;
  persistSessionSnapshot: (session: AgentSessionState) => Promise<void>;
  attachSessionListener: (repoPath: string, sessionId: string) => void;
};

export type RuntimeDependencies = {
  adapter: AgentEnginePort;
  ensureRuntime: (
    repoPath: string,
    taskId: string,
    role: AgentRole,
    options?: {
      workingDirectoryOverride?: string | null;
    },
  ) => Promise<RuntimeInfo>;
};

export type TaskDependencies = {
  taskRef: { current: TaskCard[] };
  loadTaskDocuments: (repoPath: string, taskId: string) => Promise<TaskDocuments>;
  refreshTaskData: (repoPath: string) => Promise<void>;
  sendAgentMessage: (sessionId: string, content: string) => Promise<void>;
};

export type ModelDependencies = {
  loadRepoDefaultModel: (repoPath: string, role: AgentRole) => Promise<AgentModelSelection | null>;
  loadRepoPromptOverrides: (repoPath: string) => Promise<RepoPromptOverrides>;
  loadSessionTodos: (
    sessionId: string,
    baseUrl: string,
    workingDirectory: string,
    externalSessionId: string,
  ) => Promise<void>;
  loadSessionModelCatalog: (
    sessionId: string,
    baseUrl: string,
    workingDirectory: string,
  ) => Promise<void>;
};

export type RepoDependencies = {
  activeRepo: string | null;
  repoEpochRef: { current: number };
  previousRepoRef: { current: string | null };
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
  scenario: AgentScenario;
  sessionId: string;
};

export type StartSessionContext = {
  repoPath: string;
  taskId: string;
  role: AgentRole;
  isStaleRepoOperation: RepoStaleGuard;
};

export type StartedSessionContext = StartSessionContext & {
  summary: SessionStartSummary;
  resolvedScenario: AgentScenario;
};

export type StartSessionExecutionDependencies = Pick<
  StartSessionDependencies,
  "session" | "runtime" | "task" | "model"
>;

export type StartSessionCreationInput = {
  scenario: AgentScenario | undefined;
  selectedModel: AgentModelSelection | null;
  startMode: "reuse_latest" | "fresh";
  requireModelReady: boolean;
  workingDirectoryOverride?: string | null;
};

export type ResolvedRuntimeAndModel = {
  taskCard: TaskCard;
  runtime: RuntimeInfo;
  resolvedScenario: AgentScenario;
  systemPrompt: string;
  promptOverrides: RepoPromptOverrides;
  defaultModelSelectionPromise: Promise<AgentModelSelection | null>;
  resolvedDefaultModelSelection: AgentModelSelection | null;
};

export type StartOrReuseResult =
  | {
      kind: "reused";
      sessionId: string;
    }
  | {
      kind: "started";
      runtimeInfo: RuntimeInfo;
      taskCard: TaskCard;
      ctx: StartedSessionContext;
      promptOverrides: RepoPromptOverrides;
      defaultModelSelectionPromise: Promise<AgentModelSelection | null>;
      resolvedDefaultModelSelection: AgentModelSelection | null;
    };
