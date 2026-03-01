import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  AgentRuntimeSummary,
  BeadsCheck,
  GitBranch,
  RunSummary,
  TaskCard,
  WorkspaceRecord,
} from "@openducktor/contracts";
import { createElement, type ReactElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { RepoOpencodeHealthCheck } from "@/types/diagnostics";
import type {
  AgentStateContextValue,
  ChecksStateContextValue,
  DelegationStateContextValue,
  SpecStateContextValue,
  TasksStateContextValue,
  WorkspaceStateContextValue,
} from "@/types/state-slices";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const runtimeInfo: AgentRuntimeSummary = {
  runtimeId: "runtime-1",
  repoPath: "/repo-a",
  taskId: "task-1",
  role: "build",
  workingDirectory: "/tmp/repo-a",
  port: 8080,
  startedAt: "2026-02-28T10:00:00.000Z",
};

const workspaceRecord: WorkspaceRecord = {
  path: "/repo-a",
  isActive: true,
  hasConfig: true,
  configuredWorktreeBasePath: null,
};

const branchRecord: GitBranch = {
  name: "main",
  isCurrent: true,
  isRemote: false,
};

const tasksList: TaskCard[] = [
  {
    id: "task-1",
    title: "Task One",
    status: "open",
    createdAt: "2026-02-28T10:00:00.000Z",
    updatedAt: "2026-02-28T10:00:00.000Z",
  } as TaskCard,
];

const runsList: RunSummary[] = [
  {
    runId: "run-1",
    repoPath: "/repo-a",
    taskId: "task-1",
    branch: "main",
    worktreePath: "/tmp/repo-a",
    port: 8080,
    state: "running",
    lastMessage: null,
    startedAt: "2026-02-28T10:00:00.000Z",
  },
];

const beadsCheck: BeadsCheck = {
  beadsOk: true,
  beadsPath: "/repo-a/.beads",
  beadsError: null,
};

const opencodeHealth: RepoOpencodeHealthCheck = {
  runtimeOk: true,
  runtimeError: null,
  runtime: runtimeInfo,
  mcpOk: true,
  mcpError: null,
  mcpServerName: "openducktor",
  mcpServerStatus: "connected",
  mcpServerError: null,
  availableToolIds: ["odt_read_task"],
  checkedAt: "2026-02-28T10:00:00.000Z",
  errors: [],
};

const checkRepoOpencodeHealth = mock(async (_repoPath: string) => opencodeHealth);
const createHostCatalogOps = mock((_agentEngine: unknown) => ({
  checkRepoOpencodeHealth,
}));
const configureCatalogOps = mock((_ops: unknown) => {});

const refreshRuntimeCheck = mock(async (_force?: boolean) => ({
  gitOk: true,
  gitVersion: "2.45.0",
  opencodeOk: true,
  opencodeVersion: "0.12.0",
  errors: [],
}));
const refreshBeadsCheckForRepo = mock(async (_repoPath: string, _force?: boolean) => beadsCheck);
const refreshRepoOpencodeHealthForRepo = mock(
  async (_repoPath: string, _force?: boolean) => opencodeHealth,
);
const refreshChecks = mock(async () => {});
const hasRuntimeCheck = mock(() => true);
const hasCachedBeadsCheck = mock((_repoPath: string) => false);
const hasCachedRepoOpencodeHealth = mock((_repoPath: string) => false);
const clearActiveBeadsCheck = mock(() => {});
const clearActiveRepoOpencodeHealth = mock(() => {});
const setIsLoadingChecks = mock((_value: boolean) => {});
const useChecksHook = mock((_args: { activeRepo: string | null }) => ({
  runtimeCheck: null,
  activeBeadsCheck: null,
  activeRepoOpencodeHealth: null,
  isLoadingChecks: false,
  setIsLoadingChecks,
  refreshRuntimeCheck,
  refreshBeadsCheckForRepo,
  refreshRepoOpencodeHealthForRepo,
  refreshChecks,
  hasRuntimeCheck,
  hasCachedBeadsCheck,
  hasCachedRepoOpencodeHealth,
  clearActiveBeadsCheck,
  clearActiveRepoOpencodeHealth,
}));

const refreshTaskData = mock(async (_repoPath: string) => {});
const refreshTasks = mock(async () => {});
const createTask = mock(async (_input: unknown) => {});
const updateTask = mock(async (_taskId: string, _patch: unknown) => {});
const deleteTask = mock(async (_taskId: string, _deleteSubtasks?: boolean) => {});
const transitionTask = mock(async (_taskId: string, _status: unknown, _reason?: string) => {});
const deferTask = mock(async (_taskId: string) => {});
const resumeDeferredTask = mock(async (_taskId: string) => {});
const humanApproveTask = mock(async (_taskId: string) => {});
const humanRequestChangesTask = mock(async (_taskId: string, _note?: string) => {});
const clearTaskData = mock(() => {});
const setIsLoadingTasks = mock((_value: boolean) => {});
const useTaskOperationsHook = mock((_args: { activeRepo: string | null }) => ({
  tasks: tasksList,
  runs: runsList,
  isLoadingTasks: false,
  setIsLoadingTasks,
  clearTaskData,
  refreshTaskData,
  refreshTasks,
  createTask,
  updateTask,
  deleteTask,
  transitionTask,
  deferTask,
  resumeDeferredTask,
  humanApproveTask,
  humanRequestChangesTask,
}));

const refreshWorkspaces = mock(async () => {});
const addWorkspace = mock(async (_repoPath: string) => {});
const selectWorkspace = mock(async (_repoPath: string) => {});
const refreshBranches = mock(async (_force?: boolean) => {});
const switchBranch = mock(async (_branchName: string) => {});
const clearBranchData = mock(() => {});
const useWorkspaceOperationsHook = mock(
  (_args: { activeRepo: string | null; setActiveRepo: (value: string | null) => void }) => ({
    workspaces: [workspaceRecord],
    branches: [branchRecord],
    activeBranch: { name: "main", detached: false },
    isSwitchingWorkspace: false,
    isLoadingBranches: false,
    isSwitchingBranch: false,
    refreshWorkspaces,
    addWorkspace,
    selectWorkspace,
    refreshBranches,
    switchBranch,
    clearBranchData,
  }),
);

const loadRepoSettings = mock(async () => ({
  worktreeBasePath: "/tmp/worktree",
  branchPrefix: "codex/",
  trustedHooks: false,
  preStartHooks: [],
  postCompleteHooks: [],
  agentDefaults: {
    spec: null,
    planner: null,
    build: null,
    qa: null,
  },
}));
const saveRepoSettings = mock(async (_input: unknown) => {});
const useRepoSettingsOperationsHook = mock((_args: { activeRepo: string | null }) => ({
  loadRepoSettings,
  saveRepoSettings,
}));

const delegateTask = mock(async (_taskId: string) => {});
const delegateRespond = mock(async (_runId: string, _action: unknown, _payload?: string) => {});
const delegateStop = mock(async (_runId: string) => {});
const delegateCleanup = mock(async (_runId: string, _mode: unknown) => {});
const useDelegationOperationsHook = mock((_args: { activeRepo: string | null }) => ({
  delegateTask,
  delegateRespond,
  delegateStop,
  delegateCleanup,
}));

const loadSpec = mock(async (_taskId: string) => "spec");
const loadSpecDocument = mock(async (_taskId: string) => ({
  markdown: "spec",
  updatedAt: "2026-02-28T10:00:00.000Z",
}));
const loadPlanDocument = mock(async (_taskId: string) => ({
  markdown: "plan",
  updatedAt: "2026-02-28T10:00:00.000Z",
}));
const loadQaReportDocument = mock(async (_taskId: string) => ({
  markdown: "qa",
  updatedAt: "2026-02-28T10:00:00.000Z",
}));
const saveSpec = mock(async (_taskId: string, _markdown: string) => ({
  updatedAt: "2026-02-28T10:00:00.000Z",
}));
const saveSpecDocument = mock(async (_taskId: string, _markdown: string) => ({
  updatedAt: "2026-02-28T10:00:00.000Z",
}));
const savePlanDocument = mock(async (_taskId: string, _markdown: string) => ({
  updatedAt: "2026-02-28T10:00:00.000Z",
}));
const useSpecOperationsHook = mock((_args: { activeRepo: string | null }) => ({
  loadSpec,
  loadSpecDocument,
  loadPlanDocument,
  loadQaReportDocument,
  saveSpec,
  saveSpecDocument,
  savePlanDocument,
}));

const loadAgentSessions = mock(async (_taskId: string) => {});
const startAgentSession = mock(async (_input: unknown) => "session-1");
const sendAgentMessage = mock(async (_sessionId: string, _content: string) => {});
const stopAgentSession = mock(async (_sessionId: string) => {});
const updateAgentSessionModel = mock((_sessionId: string, _selection: unknown) => {});
const replyAgentPermission = mock(
  async (_sessionId: string, _requestId: string, _reply: unknown, _message?: string) => {},
);
const answerAgentQuestion = mock(
  async (_sessionId: string, _requestId: string, _answers: string[][]) => {},
);
const useAgentOrchestratorOperationsHook = mock((_args: { activeRepo: string | null }) => ({
  sessions: [],
  loadAgentSessions,
  startAgentSession,
  sendAgentMessage,
  stopAgentSession,
  updateAgentSessionModel,
  replyAgentPermission,
  answerAgentQuestion,
}));

const useAppLifecycleHook = mock((_args: unknown) => {});

mock.module("@openducktor/adapters-opencode-sdk", () => ({
  OpencodeSdkAdapter: class OpencodeSdkAdapter {},
}));

mock.module("./operations", () => ({
  configureOpencodeCatalogOperations: (ops: unknown) => configureCatalogOps(ops),
  createHostOpencodeCatalogOperations: (agentEngine: unknown) => createHostCatalogOps(agentEngine),
  useAgentOrchestratorOperations: (args: unknown) =>
    useAgentOrchestratorOperationsHook(args as { activeRepo: string | null }),
  useChecks: (args: unknown) => useChecksHook(args as { activeRepo: string | null }),
  useDelegationOperations: (args: unknown) =>
    useDelegationOperationsHook(args as { activeRepo: string | null }),
  useRepoSettingsOperations: (args: unknown) =>
    useRepoSettingsOperationsHook(args as { activeRepo: string | null }),
  useSpecOperations: (args: unknown) =>
    useSpecOperationsHook(args as { activeRepo: string | null }),
  useTaskOperations: (args: unknown) =>
    useTaskOperationsHook(args as { activeRepo: string | null }),
  useWorkspaceOperations: (args: unknown) =>
    useWorkspaceOperationsHook(
      args as { activeRepo: string | null; setActiveRepo: (value: string | null) => void },
    ),
}));

mock.module("./lifecycle/use-app-lifecycle", () => ({
  useAppLifecycle: (args: unknown) => useAppLifecycleHook(args),
}));

type StateModule = typeof import("./app-state-provider");

let AppStateProvider: StateModule["AppStateProvider"];
let useWorkspaceState: StateModule["useWorkspaceState"];
let useChecksState: StateModule["useChecksState"];
let useTasksState: StateModule["useTasksState"];
let useDelegationState: StateModule["useDelegationState"];
let useSpecState: StateModule["useSpecState"];
let useAgentState: StateModule["useAgentState"];

beforeAll(async () => {
  ({
    AppStateProvider,
    useWorkspaceState,
    useChecksState,
    useTasksState,
    useDelegationState,
    useSpecState,
    useAgentState,
  } = await import("./app-state-provider"));
});

beforeEach(() => {
  createHostCatalogOps.mockClear();
  configureCatalogOps.mockClear();
  useChecksHook.mockClear();
  useTaskOperationsHook.mockClear();
  useWorkspaceOperationsHook.mockClear();
  useRepoSettingsOperationsHook.mockClear();
  useDelegationOperationsHook.mockClear();
  useSpecOperationsHook.mockClear();
  useAgentOrchestratorOperationsHook.mockClear();
  useAppLifecycleHook.mockClear();
});

describe("AppStateProvider", () => {
  test("composes all state slices and preserves hook access", async () => {
    type Snapshot = {
      workspace: WorkspaceStateContextValue;
      checks: ChecksStateContextValue;
      tasks: TasksStateContextValue;
      delegation: DelegationStateContextValue;
      spec: SpecStateContextValue;
      agent: AgentStateContextValue;
    };

    let snapshot = {} as Snapshot;

    const Probe = (): ReactElement => {
      snapshot = {
        workspace: useWorkspaceState(),
        checks: useChecksState(),
        tasks: useTasksState(),
        delegation: useDelegationState(),
        spec: useSpecState(),
        agent: useAgentState(),
      };
      return createElement("div");
    };

    let renderer: TestRenderer.ReactTestRenderer | null = null;

    try {
      await act(async () => {
        renderer = TestRenderer.create(createElement(AppStateProvider, null, createElement(Probe)));
      });
      await flush();

      expect(snapshot.workspace.activeRepo).toBeNull();
      expect(snapshot.workspace.workspaces).toEqual([workspaceRecord]);
      expect(snapshot.checks.isLoadingChecks).toBe(false);
      expect(snapshot.tasks.tasks).toEqual(tasksList);
      expect(snapshot.tasks.runs).toEqual(runsList);
      expect(snapshot.delegation.events).toEqual([]);
      expect(snapshot.spec.loadSpec).toBe(loadSpec);
      expect(snapshot.agent.sessions).toEqual([]);

      expect(useChecksHook).toHaveBeenCalledWith({
        activeRepo: null,
        checkRepoOpencodeHealth,
      });

      expect(useTaskOperationsHook).toHaveBeenCalledWith({
        activeRepo: null,
        refreshBeadsCheckForRepo,
      });

      expect(useWorkspaceOperationsHook).toHaveBeenCalledWith({
        activeRepo: null,
        setActiveRepo: expect.any(Function),
        clearTaskData,
        clearActiveBeadsCheck,
      });

      expect(useAgentOrchestratorOperationsHook).toHaveBeenCalledWith({
        activeRepo: null,
        tasks: tasksList,
        runs: runsList,
        refreshTaskData,
        agentEngine: expect.anything(),
      });

      expect(useAppLifecycleHook).toHaveBeenCalledTimes(1);
      expect(createHostCatalogOps).toHaveBeenCalledTimes(1);
      expect(configureCatalogOps).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
    }
  });
});
