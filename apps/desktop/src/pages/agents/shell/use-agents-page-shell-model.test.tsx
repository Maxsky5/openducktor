import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement, type ReactElement, type ReactNode } from "react";
import type { SessionStartModalModel } from "@/components/features/agents";
import * as appStateContexts from "@/state/app-state-contexts";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import type { TasksStateContextValue } from "@/types/state-slices";
import {
  createAgentSessionFixture,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "../agent-studio-test-utils";

enableReactActEnvironment();

const task = createTaskCardFixture({ id: "task-1", title: "Task 1" });
const createSession = () =>
  createAgentSessionFixture({
    sessionId: "session-1",
    taskId: "task-1",
    role: "planner",
    scenario: "planner_initial",
    runtimeKind: "opencode",
  });
type SessionFixture = ReturnType<typeof createSession>;

const retryNavigationPersistence = mock(() => {});
const updateQuery = mock((_updates?: unknown) => {});
const handleSelectTab = mock((_value: string) => {});
const retryChatSettingsLoad = mock(() => {});
const handleResolveRebaseConflict = mock(async () => {});

type QuerySyncState = {
  taskIdParam: string;
  sessionParam: string;
  hasExplicitRoleParam: boolean;
  roleFromQuery: "planner";
  scenarioFromQuery: "planner_initial";
  isRepoNavigationBoundaryPending: boolean;
  navigationPersistenceError: Error | null;
  retryNavigationPersistence: typeof retryNavigationPersistence;
  updateQuery: typeof updateQuery;
};

type SelectionState = {
  viewTaskId: string;
  viewRole: "planner";
  viewScenario: "planner_initial";
  viewSelectedTask: typeof task | null;
  viewSessionsForTask: SessionFixture[];
  viewActiveSession: SessionFixture | null;
  activeTaskTabId: string;
  taskTabs: [];
  availableTabTasks: (typeof task)[];
  selectedSessionById: Record<string, SessionFixture>;
  taskId: string;
  activeSession: SessionFixture | null;
  isActiveTaskHydrated: boolean;
  isActiveTaskHydrationFailed: boolean;
  isViewSessionHistoryHydrationFailed: boolean;
  isViewSessionHistoryHydrating: boolean;
  sessionsForTask: SessionFixture[];
  handleCreateTab: (taskId: string) => void;
  handleCloseTab: (taskId: string) => void;
  handleSelectTab: typeof handleSelectTab;
};

type ReadinessState = {
  agentStudioReadinessState: "ready" | "checking" | "blocked";
  agentStudioReady: boolean;
  agentStudioBlockedReason: string | null;
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
};

type OrchestrationState = {
  repoSettings: null;
  chatSettingsLoadError: Error | null;
  retryChatSettingsLoad: typeof retryChatSettingsLoad;
  humanReviewFeedbackModal: { kind: string };
  sessionStartModal: SessionStartModalModel | null;
  startSessionRequest: (request: unknown) => Promise<string | undefined>;
  activeTabValue: string;
  agentStudioTaskTabsModel: { tabs: [] };
  agentStudioHeaderModel: { title: string };
  agentStudioWorkspaceSidebarModel: { activeDocument: null };
  agentChatModel: { kind: string };
  rightPanel: {
    panelKind: "documents";
    isPanelOpen: boolean;
    rightPanelToggleModel: { label: string };
  };
};

type RightPanelState = {
  isRightPanelVisible: boolean;
  rightPanelModel: { kind: string };
};

type AgentsPageShellModelState = {
  activeRepo: string | null;
  navigationPersistenceError: Error | null;
  chatSettingsLoadError: Error | null;
  onRetryNavigationPersistence: () => void;
  onRetryChatSettingsLoad: () => void;
  hasSelectedTask: boolean;
  isRightPanelVisible: boolean;
  rightPanelContent: ReactElement | null;
  sessionStartModal: ReactElement | null;
  mergedPullRequestModal: ReactElement | null;
  humanReviewFeedbackModal: ReactElement;
  taskDetailsSheet: ReactElement;
};

let workspaceState = {
  activeRepo: "/repo",
  activeBranch: "main",
};
let checksState = {
  runtimeHealthByRuntime: {},
  isLoadingChecks: false,
  refreshChecks: async () => undefined,
};
let tasksState: TasksStateContextValue = {
  isForegroundLoadingTasks: false,
  isRefreshingTasksInBackground: false,
  isLoadingTasks: false,
  tasks: [task],
  runs: [],
  refreshTasks: mock(async () => undefined),
  syncPullRequests: mock(async () => undefined),
  linkMergedPullRequest: mock(async () => undefined),
  cancelLinkMergedPullRequest: mock(() => undefined),
  unlinkPullRequest: mock(async () => undefined),
  createTask: mock(async () => undefined),
  updateTask: mock(async () => undefined),
  deleteTask: mock(async () => undefined),
  resetTaskImplementation: mock(async () => undefined),
  transitionTask: mock(async () => undefined),
  deferTask: mock(async () => undefined),
  resumeDeferredTask: mock(async () => undefined),
  humanApproveTask: mock(async () => undefined),
  humanRequestChangesTask: mock(async () => undefined),
  detectingPullRequestTaskId: null,
  linkingMergedPullRequestTaskId: null,
  unlinkingPullRequestTaskId: null,
  pendingMergedPullRequest: null,
};
let agentSessions = [createSession()];
let agentOperations = {
  bootstrapTaskSessions: mock(async () => undefined),
  hydrateRequestedTaskSessionHistory: mock(async () => undefined),
  readSessionFileSearch: mock(async () => []),
  readSessionModelCatalog: mock(async () => ({
    providers: [],
    models: [],
    variants: [],
    profiles: [],
    defaultModelsByProvider: {},
  })),
  readSessionSlashCommands: mock(async () => ({ commands: [] })),
  readSessionTodos: mock(async () => []),
  startAgentSession: mock(async () => "session-1"),
  sendAgentMessage: mock(async () => undefined),
  stopAgentSession: mock(async () => undefined),
  updateAgentSessionModel: mock(() => undefined),
  replyAgentPermission: mock(async () => undefined),
  answerAgentQuestion: mock(async () => undefined),
};
let querySyncState: QuerySyncState = {
  taskIdParam: "task-1",
  sessionParam: "session-1",
  hasExplicitRoleParam: false,
  roleFromQuery: "planner" as const,
  scenarioFromQuery: "planner_initial" as const,
  isRepoNavigationBoundaryPending: false,
  navigationPersistenceError: new Error("navigation failed"),
  retryNavigationPersistence,
  updateQuery,
};
const initialSelectionSession = createSession();
let selectionState: SelectionState = {
  viewTaskId: "task-1",
  viewRole: "planner" as const,
  viewScenario: "planner_initial" as const,
  viewSelectedTask: task,
  viewSessionsForTask: [initialSelectionSession],
  viewActiveSession: initialSelectionSession,
  activeTaskTabId: "task-1",
  taskTabs: [],
  availableTabTasks: [task],
  selectedSessionById: { "session-1": initialSelectionSession },
  taskId: "task-1",
  activeSession: initialSelectionSession,
  isActiveTaskHydrated: true,
  isActiveTaskHydrationFailed: false,
  isViewSessionHistoryHydrationFailed: false,
  isViewSessionHistoryHydrating: false,
  sessionsForTask: [initialSelectionSession],
  handleCreateTab: mock((_taskId: string) => {}),
  handleCloseTab: mock((_taskId: string) => {}),
  handleSelectTab,
};
let readinessState: ReadinessState = {
  agentStudioReadinessState: "ready",
  agentStudioReady: true,
  agentStudioBlockedReason: null,
  isLoadingChecks: false,
  refreshChecks: async () => undefined,
};
const rightPanelToggleModel = { label: "Toggle panel" };
const rightPanelModel = { kind: "documents" };
const baseSessionStartModal: SessionStartModalModel = {
  open: true,
  title: "Start Planner Session",
  description: "Pick a model and launch a session.",
  confirmLabel: "Start session",
  selectedModelSelection: null,
  selectedRuntimeKind: "opencode",
  runtimeOptions: [],
  supportsProfiles: true,
  supportsVariants: true,
  isSelectionCatalogLoading: false,
  agentOptions: [],
  modelOptions: [],
  modelGroups: [],
  variantOptions: [],
  availableStartModes: ["fresh"],
  selectedStartMode: "fresh",
  existingSessionOptions: [],
  selectedSourceSessionId: "",
  onSelectStartMode: mock(() => {}),
  onSelectSourceSession: mock(() => {}),
  onSelectRuntime: mock(() => {}),
  onSelectAgent: mock(() => {}),
  onSelectModel: mock(() => {}),
  onSelectVariant: mock(() => {}),
  isStarting: false,
  onOpenChange: mock(() => {}),
  onConfirm: mock(() => {}),
};
let orchestrationState: OrchestrationState = {
  repoSettings: null,
  chatSettingsLoadError: new Error("chat settings failed"),
  retryChatSettingsLoad,
  humanReviewFeedbackModal: { kind: "feedback" },
  sessionStartModal: { ...baseSessionStartModal },
  startSessionRequest: async () => undefined,
  activeTabValue: "task-1",
  agentStudioTaskTabsModel: { tabs: [] },
  agentStudioHeaderModel: { title: "Task 1" },
  agentStudioWorkspaceSidebarModel: { activeDocument: null },
  agentChatModel: { kind: "chat" },
  rightPanel: {
    panelKind: "documents",
    isPanelOpen: true,
    rightPanelToggleModel,
  },
};
let rightPanelState: RightPanelState = {
  isRightPanelVisible: true,
  rightPanelModel,
};

let useAgentsPageShellModel: () => AgentsPageShellModelState;

const registerModuleMocks = (): void => {
  const stateModule = {
    AppStateProvider: ({ children }: { children: ReactElement }) => children,
    useWorkspaceState: () => workspaceState,
    useChecksState: () => checksState,
    useTasksState: () => tasksState,
    useAgentOperations: () => agentOperations,
    useAgentSessions: () => agentSessions,
    useAgentSessionSummaries: () =>
      agentSessions.map((entry) => ({
        sessionId: entry.sessionId,
        taskId: entry.taskId,
        role: entry.role,
        scenario: entry.scenario,
        status: entry.status,
        startedAt: entry.startedAt,
        workingDirectory: entry.workingDirectory,
        pendingPermissions: entry.pendingPermissions,
        pendingQuestions: entry.pendingQuestions,
        selectedModel: entry.selectedModel,
        runtimeKind: entry.runtimeKind,
      })),
    useAgentSession: (sessionId: string | null) =>
      sessionId ? (agentSessions.find((entry) => entry.sessionId === sessionId) ?? null) : null,
    useAgentState: () => ({ sessions: agentSessions, ...agentOperations }),
    useSpecState: () => {
      throw new Error("useSpecState is not used in this test");
    },
  };

  mock.module("react-router-dom", () => ({
    useNavigationType: () => "PUSH",
    useSearchParams: () => [new URLSearchParams(), mock(() => {})],
  }));

  mock.module("@/state/app-state-provider", () => stateModule);

  mock.module("@/state/app-state-contexts", () => ({
    ...appStateContexts,
    useDelegationEventsContext: () => ({
      setEvents: mock(() => {}),
      runCompletionSignal: null,
      setRunCompletionSignal: mock(() => {}),
    }),
  }));

  mock.module("../use-agent-studio-query-sync", () => ({
    useAgentStudioQuerySync: () => querySyncState,
  }));

  mock.module("../use-agent-studio-selection-controller", () => ({
    useAgentStudioSelectionController: () => selectionState,
  }));

  mock.module("../use-agent-studio-query-session-sync", () => ({
    useAgentStudioQuerySessionSync: () => undefined,
  }));

  mock.module("../use-agents-page-readiness", () => ({
    useAgentStudioReadiness: () => readinessState,
    useRunCompletionRecoverySignal: () => "run-completion-signal",
  }));

  mock.module("../use-agent-studio-orchestration-controller", () => ({
    useAgentStudioOrchestrationController: () => orchestrationState,
  }));

  mock.module("../use-agent-studio-rebase-conflict-resolution", () => ({
    useAgentStudioRebaseConflictResolution: () => ({
      handleResolveRebaseConflict,
    }),
  }));

  mock.module("../use-agents-page-right-panel-model", () => ({
    useAgentsPageRightPanelModel: () => rightPanelState,
  }));

  mock.module("@/components/features/agents", () => ({
    SessionStartModal: (props: Record<string, unknown>): ReactElement =>
      createElement("mock-session-start-modal", props),
  }));

  mock.module("@/components/features/agents/agent-studio-right-panel", () => ({
    MemoizedAgentStudioRightPanel: (props: Record<string, unknown>): ReactElement =>
      createElement("mock-agent-studio-right-panel", props),
  }));

  mock.module("@/contexts/DiffWorkerProvider", () => ({
    DiffWorkerProvider: ({ children }: { children: ReactNode }) => children,
  }));

  mock.module("@pierre/diffs/react", () => ({
    FileDiff: () => createElement("div", { "data-testid": "mock-pierre-diff-viewer" }),
    Virtualizer: ({ children }: { children: ReactNode }) =>
      createElement("div", { "data-testid": "mock-pierre-virtualizer" }, children),
    useWorkerPool: () => null,
    WorkerPoolContextProvider: ({ children }: { children: ReactNode }) => children,
  }));

  mock.module("@/features/human-review-feedback/human-review-feedback-modal", () => ({
    HumanReviewFeedbackModal: (props: Record<string, unknown>): ReactElement =>
      createElement("mock-human-review-feedback-modal", props),
  }));

  mock.module("@/components/features/task-details/task-details-sheet-controller", () => ({
    TaskDetailsSheetController: (props: Record<string, unknown>): ReactElement =>
      createElement("mock-task-details-sheet-controller", props),
  }));

  mock.module("@/components/features/pull-requests/merged-pull-request-confirm-dialog", () => ({
    MergedPullRequestConfirmDialog: (props: Record<string, unknown>): ReactElement =>
      createElement("mock-merged-pr-dialog", props),
  }));
};

beforeEach(async () => {
  registerModuleMocks();
  ({ useAgentsPageShellModel } = await import("./use-agents-page-shell-model"));
  workspaceState = {
    activeRepo: "/repo",
    activeBranch: "main",
  };
  checksState = {
    runtimeHealthByRuntime: {},
    isLoadingChecks: false,
    refreshChecks: async () => undefined,
  };
  tasksState = {
    isForegroundLoadingTasks: false,
    isRefreshingTasksInBackground: false,
    isLoadingTasks: false,
    tasks: [task],
    runs: [],
    refreshTasks: mock(async () => undefined),
    syncPullRequests: mock(async () => undefined),
    linkMergedPullRequest: mock(async () => undefined),
    cancelLinkMergedPullRequest: mock(() => undefined),
    unlinkPullRequest: mock(async () => undefined),
    createTask: mock(async () => undefined),
    updateTask: mock(async () => undefined),
    deleteTask: mock(async () => undefined),
    resetTaskImplementation: mock(async () => undefined),
    transitionTask: mock(async () => undefined),
    deferTask: mock(async () => undefined),
    resumeDeferredTask: mock(async () => undefined),
    humanApproveTask: mock(async () => undefined),
    humanRequestChangesTask: mock(async () => undefined),
    detectingPullRequestTaskId: null,
    linkingMergedPullRequestTaskId: null,
    unlinkingPullRequestTaskId: null,
    pendingMergedPullRequest: null,
  };
  const session = createSession();
  agentSessions = [session];
  agentOperations = {
    bootstrapTaskSessions: mock(async () => undefined),
    hydrateRequestedTaskSessionHistory: mock(async () => undefined),
    readSessionFileSearch: mock(async () => []),
    readSessionModelCatalog: mock(async () => ({
      providers: [],
      models: [],
      variants: [],
      profiles: [],
      defaultModelsByProvider: {},
    })),
    readSessionSlashCommands: mock(async () => ({ commands: [] })),
    readSessionTodos: mock(async () => []),
    startAgentSession: mock(async () => "session-1"),
    sendAgentMessage: mock(async () => undefined),
    stopAgentSession: mock(async () => undefined),
    updateAgentSessionModel: mock(() => undefined),
    replyAgentPermission: mock(async () => undefined),
    answerAgentQuestion: mock(async () => undefined),
  };
  querySyncState = {
    taskIdParam: "task-1",
    sessionParam: "session-1",
    hasExplicitRoleParam: false,
    roleFromQuery: "planner",
    scenarioFromQuery: "planner_initial",
    isRepoNavigationBoundaryPending: false,
    navigationPersistenceError: new Error("navigation failed"),
    retryNavigationPersistence,
    updateQuery,
  };
  selectionState = {
    viewTaskId: "task-1",
    viewRole: "planner",
    viewScenario: "planner_initial",
    viewSelectedTask: task,
    viewSessionsForTask: [session],
    viewActiveSession: session,
    activeTaskTabId: "task-1",
    taskTabs: [],
    availableTabTasks: [task],
    selectedSessionById: { "session-1": session },
    taskId: "task-1",
    activeSession: session,
    isActiveTaskHydrated: true,
    isActiveTaskHydrationFailed: false,
    isViewSessionHistoryHydrationFailed: false,
    isViewSessionHistoryHydrating: false,
    sessionsForTask: [session],
    handleCreateTab: mock((_taskId: string) => {}),
    handleCloseTab: mock((_taskId: string) => {}),
    handleSelectTab,
  };
  readinessState = {
    agentStudioReadinessState: "ready",
    agentStudioReady: true,
    agentStudioBlockedReason: null,
    isLoadingChecks: false,
    refreshChecks: async () => undefined,
  };
  orchestrationState = {
    repoSettings: null,
    chatSettingsLoadError: new Error("chat settings failed"),
    retryChatSettingsLoad,
    humanReviewFeedbackModal: { kind: "feedback" },
    sessionStartModal: {
      ...baseSessionStartModal,
    },
    startSessionRequest: async () => undefined,
    activeTabValue: "task-1",
    agentStudioTaskTabsModel: { tabs: [] },
    agentStudioHeaderModel: { title: "Task 1" },
    agentStudioWorkspaceSidebarModel: { activeDocument: null },
    agentChatModel: { kind: "chat" },
    rightPanel: {
      panelKind: "documents",
      isPanelOpen: true,
      rightPanelToggleModel,
    },
  };
  rightPanelState = {
    isRightPanelVisible: true,
    rightPanelModel,
  };
});

afterAll(async () => {
  await restoreMockedModules([
    ["react-router-dom", () => import("react-router-dom")],
    ["@/state/app-state-provider", () => import("@/state/app-state-provider")],
    ["@/contexts/DiffWorkerProvider", () => import("@/contexts/DiffWorkerProvider")],
    ["@pierre/diffs/react", () => import("@pierre/diffs/react")],
    ["@/state/app-state-contexts", () => import("@/state/app-state-contexts")],
    ["../use-agent-studio-query-sync", () => import("../use-agent-studio-query-sync")],
    [
      "../use-agent-studio-selection-controller",
      () => import("../use-agent-studio-selection-controller"),
    ],
    [
      "../use-agent-studio-query-session-sync",
      () => import("../use-agent-studio-query-session-sync"),
    ],
    ["../use-agents-page-readiness", () => import("../use-agents-page-readiness")],
    [
      "../use-agent-studio-orchestration-controller",
      () => import("../use-agent-studio-orchestration-controller"),
    ],
    [
      "../use-agent-studio-rebase-conflict-resolution",
      () => import("../use-agent-studio-rebase-conflict-resolution"),
    ],
    ["../use-agents-page-right-panel-model", () => import("../use-agents-page-right-panel-model")],
    ["@/components/features/agents", () => import("@/components/features/agents")],
    [
      "@/features/human-review-feedback/human-review-feedback-modal",
      () => import("@/features/human-review-feedback/human-review-feedback-modal"),
    ],
    [
      "@/components/features/task-details/task-details-sheet-controller",
      () => import("@/components/features/task-details/task-details-sheet-controller"),
    ],
    [
      "@/components/features/pull-requests/merged-pull-request-confirm-dialog",
      () => import("@/components/features/pull-requests/merged-pull-request-confirm-dialog"),
    ],
  ]);
});

const createHookHarness = () =>
  createSharedHookHarness((_: undefined) => useAgentsPageShellModel(), undefined);

describe("useAgentsPageShellModel", () => {
  test("surfaces hook state and wires modal/controller elements", async () => {
    tasksState = {
      ...tasksState,
      pendingMergedPullRequest: {
        taskId: "task-1",
        pullRequest: {
          providerId: "github",
          number: 268,
          url: "https://github.com/Maxsky5/openducktor/pull/268",
          state: "merged",
          createdAt: "2026-03-20T11:00:00Z",
          updatedAt: "2026-03-20T11:21:32Z",
          lastSyncedAt: "2026-03-20T11:21:32Z",
          mergedAt: "2026-03-20T11:21:32Z",
          closedAt: "2026-03-20T11:21:32Z",
        },
      },
    };
    const harness = createHookHarness();

    try {
      await harness.mount();

      const state = harness.getLatest();
      expect(state.activeRepo).toBe("/repo");
      expect(state.navigationPersistenceError).toBe(querySyncState.navigationPersistenceError);
      expect(state.chatSettingsLoadError).toBe(orchestrationState.chatSettingsLoadError);
      expect(state.onRetryNavigationPersistence).toBe(retryNavigationPersistence);
      expect(state.onRetryChatSettingsLoad).toBe(retryChatSettingsLoad);
      expect(state.hasSelectedTask).toBe(true);
      expect(state.isRightPanelVisible).toBe(true);
      expect(state.rightPanelContent).not.toBeNull();
      expect(
        (state.sessionStartModal as ReactElement<{ model: unknown }> | null)?.props.model,
      ).toBe(orchestrationState.sessionStartModal);
      expect((state.taskDetailsSheet as ReactElement<{ allTasks: unknown }>).props.allTasks).toBe(
        tasksState.tasks,
      );
      expect((state.humanReviewFeedbackModal as ReactElement<{ model: unknown }>).props.model).toBe(
        orchestrationState.humanReviewFeedbackModal,
      );
      expect(
        (state.mergedPullRequestModal as ReactElement<{ pullRequest: unknown }> | null)?.props
          .pullRequest,
      ).toEqual(tasksState.pendingMergedPullRequest?.pullRequest ?? null);
    } finally {
      await harness.unmount();
    }
  });

  test("omits pending modals when no requests are active and reports no selected task", async () => {
    orchestrationState = {
      ...orchestrationState,
      sessionStartModal: null,
    };
    selectionState = {
      ...selectionState,
      viewTaskId: "",
      viewSelectedTask: null,
    };

    const harness = createHookHarness();

    try {
      await harness.mount();

      const state = harness.getLatest();
      expect(state.hasSelectedTask).toBe(false);
      expect(state.sessionStartModal).toBeNull();
      expect(state.mergedPullRequestModal).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("keeps the shell stable while repo-boundary reset clears stale Agent Studio selection", async () => {
    querySyncState = {
      ...querySyncState,
      isRepoNavigationBoundaryPending: true,
    };
    selectionState = {
      ...selectionState,
      viewTaskId: "",
      viewSelectedTask: null,
      viewActiveSession: null,
      taskId: "",
      activeSession: null,
      selectedSessionById: {},
      sessionsForTask: [],
      viewSessionsForTask: [],
    };

    const harness = createHookHarness();

    try {
      await harness.mount();

      const state = harness.getLatest();
      expect(state.activeRepo).toBe("/repo");
      expect(state.hasSelectedTask).toBe(false);
      expect(state.isRightPanelVisible).toBe(true);
      expect(state.taskDetailsSheet).not.toBeNull();
    } finally {
      await harness.unmount();
    }
  });
});
