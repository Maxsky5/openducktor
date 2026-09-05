import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type {
  AgentSessionControlSummary,
  AgentSessionRecord,
  AgentWorkflowSessionStartInput,
} from "@openducktor/contracts";
import type { AgentEnginePort, AgentModelSelection } from "@openducktor/core";
import { createSessionStartGate } from "@/features/session-start/session-start-gate";
import { appQueryClient } from "@/lib/query-client";
import {
  type AgentSessionCollection,
  createAgentSessionCollection as createStrictAgentSessionCollection,
  emptyAgentSessionCollection,
  getAgentSession,
  listAgentSessions,
  replaceAgentSession,
} from "@/state/agent-session-collection";
import { agentSessionQueryKeys } from "@/state/queries/agent-sessions";
import {
  type AgentSessionFixtureOverrides,
  createAgentSessionFixture,
  createSettingsSnapshotFixture,
} from "@/test-utils/shared-test-fixtures";
import type {
  AgentChatMessage,
  AgentSessionIdentity,
  AgentSessionState as BaseAgentSessionState,
  SessionMessagesState,
} from "@/types/agent-orchestrator";
import { createSessionMessagesState } from "../support/messages";
import { createTaskCardFixture } from "../test-utils";
import { createOpenCodeAgentEngineTestAdapter } from "./opencode-agent-engine.test-support";
import { createStartAgentSession, type StartSessionDependencies } from "./start-session";

type AgentSessionState = BaseAgentSessionState & { runId?: string | null };
export type TestAgentSessionState = AgentSessionFixtureOverrides & {
  externalSessionId: string;
  messages: AgentChatMessage[] | SessionMessagesState;
};

const toAgentSessionStateFixture = (session: TestAgentSessionState): AgentSessionState =>
  createAgentSessionFixture({
    ...session,
    messages: Array.isArray(session.messages)
      ? createSessionMessagesState(session.externalSessionId, session.messages)
      : session.messages,
  });

export const createAgentSessionCollection = (sessions: Iterable<TestAgentSessionState>) =>
  createStrictAgentSessionCollection(Array.from(sessions, toAgentSessionStateFixture));

export const getSession = (
  sessionCollection: AgentSessionCollection,
  externalSessionId: string,
): AgentSessionState | undefined =>
  listAgentSessions(sessionCollection).find(
    (session): session is AgentSessionState => session.externalSessionId === externalSessionId,
  );

export const createSessionsRef = (sessions: TestAgentSessionState[] = []) => ({
  current: createAgentSessionCollection(sessions),
});

export const persistedSessionRecord = (
  input: Pick<
    AgentSessionRecord,
    "externalSessionId" | "role" | "startedAt" | "workingDirectory" | "runtimeKind"
  > &
    Partial<Pick<AgentSessionRecord, "selectedModel">>,
): AgentSessionRecord => ({
  runtimeKind: input.runtimeKind,
  externalSessionId: input.externalSessionId,
  role: input.role,
  startedAt: input.startedAt,
  workingDirectory: input.workingDirectory,
  selectedModel: input.selectedModel ?? null,
});

export const continuationTarget = (
  workingDirectory: string,
  source: "active_build_run" | "builder_session" = "active_build_run",
) => ({
  workingDirectory,
  source,
});

export const setPersistedSessionListFixture = (
  repoPath: string,
  taskId: string,
  sessions: AgentSessionRecord[],
): void => {
  appQueryClient.setQueryData(agentSessionQueryKeys.list(repoPath, taskId), sessions);
};

export const taskFixture = createTaskCardFixture({
  title: "Implement feature",
  description: "desc",
  status: "in_progress",
  priority: 1,
});

export const BUILD_SELECTION: AgentModelSelection = {
  runtimeKind: "opencode",
  providerId: "openai",
  modelId: "gpt-5",
  variant: "default",
  profileId: "build",
};

export const PLANNER_SELECTION: AgentModelSelection = {
  runtimeKind: "opencode",
  providerId: "openai",
  modelId: "gpt-5",
  variant: "default",
  profileId: "planner",
};

export const QA_SELECTION: AgentModelSelection = {
  runtimeKind: "opencode",
  providerId: "openai",
  modelId: "gpt-5",
  variant: "default",
  profileId: "qa",
};

export const sessionIdentity = (
  externalSessionId: string,
  workingDirectory = "/tmp/repo",
): AgentSessionIdentity => ({
  externalSessionId,
  runtimeKind: "opencode",
  workingDirectory,
});

export const sessionFixture = (
  overrides: Partial<TestAgentSessionState> & { externalSessionId: string },
): TestAgentSessionState => ({
  runtimeKind: "opencode",
  sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },

  status: "idle",
  runtimeStatusMessage: null,
  startedAt: "2026-02-22T08:10:00.000Z",
  workingDirectory: "/tmp/repo/worktree",
  historyLoadState: "not_requested",
  messages: [],
  pendingApprovals: [],
  pendingQuestions: [],
  selectedModel: null,
  ...overrides,
});

export const workflowSessionStartSummary = (
  input: AgentWorkflowSessionStartInput,
  overrides: Partial<AgentSessionControlSummary> = {},
): AgentSessionControlSummary => ({
  externalSessionId: "session-1",
  runtimeKind: input.runtimeKind,
  workingDirectory: input.targetWorkingDirectory ?? "/tmp/repo/worktree",
  startedAt: "2026-02-22T08:10:00.000Z",
  status: "idle",
  ...overrides,
});

export const defaultStartWorkflowSession = async (
  input: AgentWorkflowSessionStartInput,
): Promise<AgentSessionControlSummary> => workflowSessionStartSummary(input);

export type FlatStartSessionDependencies = Omit<
  StartSessionDependencies["repo"],
  "workspaceRepoPath" | "workspaceId"
> & {
  activeRepo?: string | null;
  workspaceId?: string | null;
  loadRepoDefaultModel?: unknown;
  sessionsRef: { current: AgentSessionCollection };
} & Omit<
    StartSessionDependencies["session"],
    "loadAgentSessionHistory" | "sessionStartGateRef" | "readSessionSnapshot"
  > &
  Partial<
    Pick<
      StartSessionDependencies["session"],
      "loadAgentSessionHistory" | "sessionStartGateRef" | "readSessionSnapshot"
    >
  > &
  Omit<StartSessionDependencies["runtime"], "canonicalizePath" | "startWorkflowSession"> &
  Partial<Pick<StartSessionDependencies["runtime"], "canonicalizePath" | "startWorkflowSession">> &
  StartSessionDependencies["task"] &
  StartSessionDependencies["model"];

export const toStartSessionDependencies = (
  deps: FlatStartSessionDependencies,
): StartSessionDependencies => {
  return {
    repo: {
      workspaceRepoPath: deps.activeRepo ?? null,
      workspaceId: deps.activeRepo == null ? null : (deps.workspaceId ?? "workspace-1"),
      repoEpochRef: deps.repoEpochRef,
      currentWorkspaceRepoPathRef: deps.currentWorkspaceRepoPathRef,
    },
    session: {
      replaceSession: deps.replaceSession,
      readSessionSnapshot:
        deps.readSessionSnapshot ??
        ((identity) => getAgentSession(deps.sessionsRef.current, identity)),
      sessionStartGateRef: deps.sessionStartGateRef ?? {
        current: createSessionStartGate(),
      },
      loadSourceSession: deps.loadSourceSession,
      loadAgentSessionHistory: deps.loadAgentSessionHistory ?? (async () => null),
      clearSessionObservationState: deps.clearSessionObservationState,
    },
    runtime: {
      adapter: deps.adapter,
      canonicalizePath: deps.canonicalizePath ?? (async (path) => path),
      startWorkflowSession: deps.startWorkflowSession ?? defaultStartWorkflowSession,
    },
    task: {
      taskRef: deps.taskRef,
      loadTaskDocuments: deps.loadTaskDocuments,
      refreshSessionRecords: deps.refreshSessionRecords,
      refreshTaskData: deps.refreshTaskData,
      sendAgentMessage: deps.sendAgentMessage,
    },
    model: {
      loadRepoPromptOverrides: deps.loadRepoPromptOverrides,
      loadSettingsSnapshot: deps.loadSettingsSnapshot,
    },
  };
};

type StartSessionHarnessOptions = Omit<
  Partial<FlatStartSessionDependencies>,
  "adapter" | "replaceSession"
> & {
  adapter?: AgentEnginePort | OpencodeSdkAdapter;
  sessionsRef?: { current: AgentSessionCollection };
  replaceSession?: StartSessionDependencies["session"]["replaceSession"];
  onSessionCollectionChange?: (collection: AgentSessionCollection) => void;
};

export const createStartSessionTestHarness = (options: StartSessionHarnessOptions = {}) => {
  const {
    activeRepo = "/tmp/repo",
    workspaceId = "workspace-1",
    adapter = new OpencodeSdkAdapter(),
    sessionsRef = { current: emptyAgentSessionCollection() },
    taskRef = { current: [] },
    repoEpochRef = { current: 1 },
    currentWorkspaceRepoPathRef = { current: "/tmp/repo" },
    clearSessionObservationState = () => undefined,
    loadSourceSession = async ({ sourceSession }) =>
      getAgentSession(sessionsRef.current, sourceSession),
    loadAgentSessionHistory = async () => null,
    canonicalizePath = async (path: string) => path,
    startWorkflowSession: startWorkflowSessionOverride = defaultStartWorkflowSession,
    loadTaskDocuments = async () => ({
      specMarkdown: "",
      planMarkdown: "",
      qaMarkdown: "",
    }),
    refreshSessionRecords = async () => {},
    refreshTaskData = async () => {},
    sendAgentMessage = async () => {},
    loadRepoPromptOverrides = async () => ({}),
    loadSettingsSnapshot = async () => createSettingsSnapshotFixture(),
    sessionStartGateRef,
    readSessionSnapshot,
    onSessionCollectionChange,
  } = options;
  const replaceSession =
    options.replaceSession ??
    ((session: Parameters<StartSessionDependencies["session"]["replaceSession"]>[0]) => {
      sessionsRef.current = replaceAgentSession(sessionsRef.current, session);
      onSessionCollectionChange?.(sessionsRef.current);
    });

  const agentEngine =
    adapter instanceof OpencodeSdkAdapter ? createOpenCodeAgentEngineTestAdapter(adapter) : adapter;
  const dependenciesInput: Parameters<typeof toStartSessionDependencies>[0] = {
    activeRepo,
    workspaceId,
    adapter: agentEngine,
    sessionsRef,
    replaceSession,
    taskRef,
    repoEpochRef,
    currentWorkspaceRepoPathRef,
    clearSessionObservationState,
    loadSourceSession,
    loadAgentSessionHistory,
    canonicalizePath,
    startWorkflowSession: startWorkflowSessionOverride,
    loadTaskDocuments,
    refreshSessionRecords,
    refreshTaskData,
    sendAgentMessage,
    loadRepoPromptOverrides,
    loadSettingsSnapshot,
  };
  if (sessionStartGateRef) {
    dependenciesInput.sessionStartGateRef = sessionStartGateRef;
  }
  if (readSessionSnapshot) {
    dependenciesInput.readSessionSnapshot = readSessionSnapshot;
  }
  const start = createStartAgentSession(toStartSessionDependencies(dependenciesInput));

  return {
    adapter,
    currentWorkspaceRepoPathRef,
    repoEpochRef,
    sessionsRef,
    start,
  };
};
