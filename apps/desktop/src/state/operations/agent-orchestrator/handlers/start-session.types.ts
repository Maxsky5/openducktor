import type {
  AgentSessionRecord,
  BuildContinuationTarget,
  GitTargetBranch,
  RepoPromptOverrides,
  TaskCard,
} from "@openducktor/contracts";
import type {
  AgentEnginePort,
  AgentModelSelection,
  AgentRole,
  AgentScenario,
  AgentUserMessagePart,
} from "@openducktor/core";
import type { AgentSessionLoadOptions, AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { RuntimeInfo, TaskDocuments } from "../runtime/runtime";

export type StartAgentSessionInput =
  | {
      taskId: string;
      role: AgentRole;
      scenario?: AgentScenario;
      selectedModel?: never;
      sendKickoff?: boolean;
      kickoffTargetBranch?: GitTargetBranch | null;
      startMode: "reuse";
      sourceSessionId: string;
    }
  | {
      taskId: string;
      role: AgentRole;
      scenario?: AgentScenario;
      selectedModel: AgentModelSelection;
      sendKickoff?: boolean;
      kickoffTargetBranch?: GitTargetBranch | null;
      startMode: "fresh";
      targetWorkingDirectory?: string | null;
    }
  | {
      taskId: string;
      role: AgentRole;
      scenario?: AgentScenario;
      selectedModel: AgentModelSelection;
      sendKickoff?: boolean;
      kickoffTargetBranch?: GitTargetBranch | null;
      startMode: "fork";
      sourceSessionId: string;
    };

export type SessionStateById = Record<string, AgentSessionState>;
export type SessionStateUpdater =
  | SessionStateById
  | ((current: SessionStateById) => SessionStateById);

export type SessionDependencies = {
  setSessionsById: (updater: SessionStateUpdater) => void;
  sessionsRef: { current: SessionStateById };
  inFlightStartsByWorkspaceTaskRef: { current: Map<string, Promise<string>> };
  loadAgentSessions: (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;
  persistSessionRecord: (taskId: string, record: AgentSessionRecord) => Promise<void>;
  attachSessionListener: (repoPath: string, sessionId: string) => void;
};

export type RuntimeDependencies = {
  resolveBuildContinuationTarget: (
    repoPath: string,
    taskId: string,
  ) => Promise<BuildContinuationTarget | null>;
  adapter: AgentEnginePort;
  ensureRuntime: (
    repoPath: string,
    taskId: string,
    role: AgentRole,
    options?: {
      workspaceId?: string | null;
      targetWorkingDirectory?: string | null;
      runtimeKind?: AgentModelSelection["runtimeKind"] | null;
    },
  ) => Promise<RuntimeInfo>;
};

export type TaskDependencies = {
  taskRef: { current: TaskCard[] };
  loadTaskDocuments: (repoPath: string, taskId: string) => Promise<TaskDocuments>;
  refreshTaskData: (repoPath: string, taskIdOrIds?: string | string[]) => Promise<void>;
  sendAgentMessage: (sessionId: string, parts: AgentUserMessagePart[]) => Promise<void>;
};

export type ModelDependencies = {
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
  loadRepoDefaultTargetBranch?: (workspaceId: string) => Promise<GitTargetBranch | null>;
};

export type RepoDependencies = {
  activeWorkspace: ActiveWorkspace | null;
  repoEpochRef: { current: number };
  activeWorkspaceRef?: { current: ActiveWorkspace | null };
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
  scenario: AgentScenario;
  sessionId: string;
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
  resolvedScenario: AgentScenario;
};

export type StartSessionExecutionDependencies = Pick<
  StartSessionDependencies,
  "session" | "runtime" | "task" | "model"
>;

export type StartSessionCreationInput = {
  scenario: AgentScenario | undefined;
} & (
  | {
      startMode: "reuse";
      selectedModel?: never;
      sourceSessionId: string;
    }
  | {
      startMode: "fresh";
      selectedModel: AgentModelSelection;
      targetWorkingDirectory?: string | null;
    }
  | {
      startMode: "fork";
      selectedModel: AgentModelSelection;
      sourceSessionId: string;
    }
);

export type ResolvedRuntimeAndModel = {
  taskCard: TaskCard;
  runtime: RuntimeInfo;
  resolvedScenario: AgentScenario;
  systemPrompt: string;
  promptOverrides: RepoPromptOverrides;
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
    };
