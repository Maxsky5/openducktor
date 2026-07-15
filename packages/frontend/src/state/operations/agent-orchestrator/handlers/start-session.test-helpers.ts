import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { createSessionStartGate } from "@/features/session-start/session-start-gate";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import { appQueryClient } from "@/lib/query-client";
import {
  type AgentSessionCollection,
  createAgentSessionCollection as createStrictAgentSessionCollection,
  emptyAgentSessionCollection,
  getAgentSession,
  listAgentSessions,
  removeAgentSession,
  replaceAgentSession,
} from "@/state/agent-session-collection";
import { agentSessionQueryKeys } from "@/state/queries/agent-sessions";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import type {
  AgentChatMessage,
  AgentSessionIdentity,
  AgentSessionState as BaseAgentSessionState,
  SessionMessagesState,
} from "@/types/agent-orchestrator";
import type { RuntimeInfo } from "../runtime/runtime";
import { createSessionMessagesState } from "../support/messages";
import { createTaskCardFixture } from "../test-utils";
import { createStartAgentSession, type StartSessionDependencies } from "./start-session";

type AgentSessionState = BaseAgentSessionState & { runId?: string | null };
export type TestAgentSessionState = Omit<AgentSessionState, "messages"> & {
  messages: AgentChatMessage[] | SessionMessagesState;
};

const toAgentSessionStateFixture = (session: TestAgentSessionState): AgentSessionState => ({
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
  input: {
    externalSessionId: string;
    role: AgentSessionRecord["role"];
    startedAt: string;
    workingDirectory: string;
    runtimeKind: AgentSessionRecord["runtimeKind"];
    selectedModel?: AgentSessionRecord["selectedModel"];
  } & Record<string, unknown>,
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
  taskId: "task-1",
  role: "build",
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

const ensureRuntimeWithKind = async (
  ...args: Parameters<StartSessionDependencies["runtime"]["ensureRuntime"]>
): Promise<RuntimeInfo> => {
  const [, , , options] = args;
  const runtimeKind = options?.runtimeKind ?? DEFAULT_RUNTIME_KIND;
  const workingDirectory = options?.targetWorkingDirectory ?? "/tmp/repo";

  return {
    runtimeKind,
    workingDirectory,
  };
};

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
  Omit<
    StartSessionDependencies["runtime"],
    | "resolveTaskWorktree"
    | "canonicalizePath"
    | "prepareTaskSessionStartupLease"
    | "completeTaskSessionStartupLease"
    | "abortTaskSessionStartupLease"
  > &
  Partial<
    Pick<
      StartSessionDependencies["runtime"],
      | "resolveTaskWorktree"
      | "canonicalizePath"
      | "prepareTaskSessionStartupLease"
      | "completeTaskSessionStartupLease"
      | "abortTaskSessionStartupLease"
    >
  > &
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
      removeSession: deps.removeSession,
      readSessionSnapshot:
        deps.readSessionSnapshot ??
        ((identity) => getAgentSession(deps.sessionsRef.current, identity)),
      sessionStartGateRef: deps.sessionStartGateRef ?? { current: createSessionStartGate() },
      loadSourceSession: deps.loadSourceSession,
      loadAgentSessionHistory: deps.loadAgentSessionHistory ?? (async () => null),
      persistSessionRecord: deps.persistSessionRecord,
      deleteSessionRecord: deps.deleteSessionRecord,
      observeAgentSession: deps.observeAgentSession,
      clearSessionObservationState: deps.clearSessionObservationState,
    },
    runtime: {
      adapter: deps.adapter,
      canonicalizePath: deps.canonicalizePath ?? (async (path) => path),
      prepareTaskSessionStartupLease:
        deps.prepareTaskSessionStartupLease ?? (async () => "lease-1"),
      completeTaskSessionStartupLease: deps.completeTaskSessionStartupLease ?? (async () => {}),
      abortTaskSessionStartupLease: deps.abortTaskSessionStartupLease ?? (async () => {}),
      resolveTaskWorktree:
        deps.resolveTaskWorktree ??
        (async () => ({
          workingDirectory: "/tmp/repo/worktree",
          source: "active_build_run",
        })),
      ensureRuntime: deps.ensureRuntime ?? ensureRuntimeWithKind,
    },
    task: {
      taskRef: deps.taskRef,
      loadTaskDocuments: deps.loadTaskDocuments,
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
  "replaceSession" | "removeSession"
> & {
  sessionsRef?: { current: AgentSessionCollection };
  replaceSession?: StartSessionDependencies["session"]["replaceSession"];
  removeSession?: StartSessionDependencies["session"]["removeSession"];
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
    observeAgentSession = async () => undefined,
    clearSessionObservationState = () => undefined,
    loadSourceSession = async ({ sourceSession }) =>
      getAgentSession(sessionsRef.current, sourceSession),
    loadAgentSessionHistory = async () => null,
    persistSessionRecord = async () => {},
    deleteSessionRecord = async () => {},
    resolveTaskWorktree = async () => ({
      workingDirectory: "/tmp/repo/worktree",
      source: "active_build_run" as const,
    }),
    canonicalizePath = async (path: string) => path,
    prepareTaskSessionStartupLease = async () => "lease-1",
    completeTaskSessionStartupLease = async () => {},
    abortTaskSessionStartupLease = async () => {},
    ensureRuntime = ensureRuntimeWithKind,
    loadTaskDocuments = async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
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
  const removeSession =
    options.removeSession ??
    ((identity: Parameters<StartSessionDependencies["session"]["removeSession"]>[0]) => {
      sessionsRef.current = removeAgentSession(sessionsRef.current, identity);
      onSessionCollectionChange?.(sessionsRef.current);
    });

  const start = createStartAgentSession(
    toStartSessionDependencies({
      activeRepo,
      workspaceId,
      adapter,
      sessionsRef,
      replaceSession,
      removeSession,
      taskRef,
      repoEpochRef,
      currentWorkspaceRepoPathRef,
      observeAgentSession,
      clearSessionObservationState,
      loadSourceSession,
      loadAgentSessionHistory,
      persistSessionRecord,
      deleteSessionRecord,
      resolveTaskWorktree,
      canonicalizePath,
      prepareTaskSessionStartupLease,
      completeTaskSessionStartupLease,
      abortTaskSessionStartupLease,
      ensureRuntime,
      loadTaskDocuments,
      refreshTaskData,
      sendAgentMessage,
      loadRepoPromptOverrides,
      loadSettingsSnapshot,
      ...(sessionStartGateRef ? { sessionStartGateRef } : {}),
      ...(readSessionSnapshot ? { readSessionSnapshot } : {}),
    }),
  );

  return {
    adapter,
    currentWorkspaceRepoPathRef,
    repoEpochRef,
    sessionsRef,
    start,
  };
};
