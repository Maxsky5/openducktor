import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import type { SessionStartModalModel } from "@/components/features/agents/session-start-modal";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import * as appStateContexts from "@/state/app-state-contexts";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import type { TasksStateContextValue, WorkspaceStateContextValue } from "@/types/state-slices";
import {
  createAgentSessionFixture,
  createSelectedSessionTranscriptStateFixture,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "../agent-studio-test-utils";
import type { useAgentStudioOrchestrationController } from "../use-agent-studio-orchestration-controller";
import type { AgentsPageModalContentModel } from "./agents-page-modal-content";
import type { AgentStudioRightPanelBridgeModel } from "./use-agent-studio-right-panel-bridge";

enableReactActEnvironment();

const actualReactRouterDomModule = await import("react-router-dom");
const actualAppStateContextsModule = appStateContexts;

const task = createTaskCardFixture({ id: "task-1", title: "Task 1" });
const createSession = () =>
  createAgentSessionFixture({
    externalSessionId: "session-1",
    taskId: "task-1",
    role: "planner",
    runtimeKind: "opencode",
  });
type SessionFixture = ReturnType<typeof createSession>;
const selectedSessionKey = (): string => agentSessionIdentityKey(createSession());

const retryNavigationPersistence = mock(() => {});
const updateQuery = mock((_updates?: unknown) => {});
const handleSelectTab = mock((_value: string) => {});
const retryChatSettingsLoad = mock(() => {});
const handleResolveRebaseConflict = mock(async () => {});

type QuerySyncState = {
  taskIdParam: string;
  sessionKeyParam: string;
  hasExplicitRoleParam: boolean;
  roleFromQuery: "planner";
  launchActionId: "planner_initial";
  isRepoNavigationBoundaryPending: boolean;
  navigationPersistenceError: Error | null;
  retryNavigationPersistence: typeof retryNavigationPersistence;
  updateQuery: typeof updateQuery;
};

type SelectionState = {
  view: {
    taskId: string;
    role: "planner";
    launchActionId: "planner_initial";
    selectedTask: typeof task | null;
    sessionsForTask: SessionFixture[];
    selectedSessionSummary: SessionFixture | null;
    activeSession: SessionFixture | null;
    sessionRuntimeData: {
      modelCatalog: null;
      todos: [];
      isLoadingModelCatalog: false;
    };
    sessionRuntimeDataError: null;
    runtimeReadiness: {
      readinessState: "ready";
      isReady: true;
      isRuntimeStarting: false;
      blockedReason: null;
      isLoadingChecks: false;
      refreshChecks: () => Promise<void>;
    };
    isTaskReady: boolean;
    transcriptState: ReturnType<typeof createSelectedSessionTranscriptStateFixture>;
  };
  activeTaskTabId: string;
  taskTabs: [];
  availableTabTasks: (typeof task)[];
  taskId: string;
  sessionsForTask: SessionFixture[];
  handleCreateTab: (taskId: string) => void;
  handleCloseTab: (taskId: string) => void;
  handleSelectTab: typeof handleSelectTab;
};

type OrchestrationState = {
  repoSettings: null;
  chatSettingsLoadError: Error | null;
  retryChatSettingsLoad: typeof retryChatSettingsLoad;
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
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
type OrchestrationControllerArgs = Parameters<typeof useAgentStudioOrchestrationController>[0];

type AgentsPageShellModelState = {
  activeWorkspace: WorkspaceStateContextValue["activeWorkspace"];
  navigationPersistenceError: Error | null;
  chatSettingsLoadError: Error | null;
  onRetryNavigationPersistence: () => void;
  onRetryChatSettingsLoad: () => void;
  hasSelectedTask: boolean;
  isRightPanelVisible: boolean;
  rightPanelBridge: AgentStudioRightPanelBridgeModel | null;
  modalContent: AgentsPageModalContentModel;
};

let workspaceState = {
  activeWorkspace: {
    workspaceId: "workspace-repo",
    workspaceName: "Repo",
    repoPath: "/repo",
    isActive: true,
    hasConfig: true,
    configuredWorktreeBasePath: null,
    defaultWorktreeBasePath: "/tmp/default-worktrees",
    effectiveWorktreeBasePath: "/tmp/default-worktrees",
  },
  activeBranch: "main",
  branches: [],
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
  refreshTasks: mock(async () => undefined),
  syncPullRequests: mock(async () => undefined),
  linkMergedPullRequest: mock(async () => undefined),
  cancelLinkMergedPullRequest: mock(() => undefined),
  unlinkPullRequest: mock(async () => undefined),
  createTask: mock(async () => undefined),
  updateTask: mock(async () => undefined),
  setTaskTargetBranch: mock(async () => undefined),
  deleteTask: mock(async () => undefined),
  resetTaskImplementation: mock(async () => undefined),
  resetTask: mock(async () => undefined),
  transitionTask: mock(async () => undefined),
  humanApproveTask: mock(async () => undefined),
  humanRequestChangesTask: mock(async () => undefined),
  detectingPullRequestTaskId: null,
  linkingMergedPullRequestTaskId: null,
  unlinkingPullRequestTaskId: null,
  pendingMergedPullRequest: null,
};
let agentSessions = [createSession()];
let agentSessionReadModelState = {
  sessionReadModelLoadState: { kind: "idle" as const },
};
const sessionIdentity = (externalSessionId: string) => ({
  externalSessionId,
  runtimeKind: "opencode" as const,
  workingDirectory: `/repo/worktrees/${externalSessionId}`,
});
let agentOperations = {
  loadAgentSessions: mock(async () => undefined),
  loadAgentSessionHistory: mock(async () => undefined),
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
  startAgentSession: mock(async () => sessionIdentity("session-1")),
  sendAgentMessage: mock(async () => undefined),
  stopAgentSession: mock(async () => undefined),
  updateAgentSessionModel: mock(() => undefined),
  replyAgentApproval: mock(async () => undefined),
  answerAgentQuestion: mock(async () => undefined),
};
let querySyncState: QuerySyncState = {
  taskIdParam: "task-1",
  sessionKeyParam: selectedSessionKey(),
  hasExplicitRoleParam: false,
  roleFromQuery: "planner" as const,
  launchActionId: "planner_initial" as const,
  isRepoNavigationBoundaryPending: false,
  navigationPersistenceError: new Error("navigation failed"),
  retryNavigationPersistence,
  updateQuery,
};
const initialSelectionSession = createSession();
let selectionState: SelectionState = {
  view: {
    taskId: "task-1",
    role: "planner" as const,
    launchActionId: "planner_initial" as const,
    selectedTask: task,
    sessionsForTask: [initialSelectionSession],
    selectedSessionSummary: initialSelectionSession,
    activeSession: initialSelectionSession,
    sessionRuntimeData: {
      modelCatalog: null,
      todos: [],
      isLoadingModelCatalog: false,
    },
    sessionRuntimeDataError: null,
    runtimeReadiness: {
      readinessState: "ready",
      isReady: true,
      isRuntimeStarting: false,
      blockedReason: null,
      isLoadingChecks: false,
      refreshChecks: async () => {},
    },
    isTaskReady: true,
    transcriptState: createSelectedSessionTranscriptStateFixture(),
  },
  activeTaskTabId: "task-1",
  taskTabs: [],
  availableTabTasks: [task],
  taskId: "task-1",
  sessionsForTask: [initialSelectionSession],
  handleCreateTab: mock((_taskId: string) => {}),
  handleCloseTab: mock((_taskId: string) => {}),
  handleSelectTab,
};
const rightPanelToggleModel = { label: "Toggle panel" };
const baseHumanReviewFeedbackModal: HumanReviewFeedbackModalModel = {
  open: true,
  taskId: "task-1",
  message: "Please address review feedback.",
  isSubmitting: false,
  onOpenChange: mock((_open: boolean) => {}),
  onMessageChange: mock((_message: string) => {}),
  onConfirm: mock(async () => undefined),
};
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
  selectedSourceSessionValue: "",
  onSelectStartMode: mock(() => {}),
  onSelectSourceSessionValue: mock(() => {}),
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
  humanReviewFeedbackModal: { ...baseHumanReviewFeedbackModal },
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
let orchestrationControllerArgs: OrchestrationControllerArgs[] = [];
let useAgentsPageShellModel: () => AgentsPageShellModelState;

const mockedModuleResets = [
  ["react-router-dom", async () => actualReactRouterDomModule],
  ["@/state/app-state-provider", () => import("../../../state/app-state-provider")],
  ["@/state/app-state-contexts", async () => actualAppStateContextsModule],
  [
    "../query-sync/use-agent-studio-query-sync",
    () => import("../query-sync/use-agent-studio-query-sync"),
  ],
  [
    "../use-agent-studio-selection-controller",
    () => import("../use-agent-studio-selection-controller"),
  ],
  [
    "../query-sync/use-agent-studio-query-session-sync",
    () => import("../query-sync/use-agent-studio-query-session-sync"),
  ],
  [
    "../use-agent-studio-orchestration-controller",
    () => import("../use-agent-studio-orchestration-controller"),
  ],
  [
    "../use-agent-studio-rebase-conflict-resolution",
    () => import("../use-agent-studio-rebase-conflict-resolution"),
  ],
] as const;

const registerModuleMocks = (): void => {
  const stateModule = {
    AppStateProvider: ({ children }: { children: ReactElement }) => children,
    useWorkspaceState: () => workspaceState,
    useChecksState: () => checksState,
    useTasksState: () => tasksState,
    useAgentOperations: () => agentOperations,
    useAgentSessionReadModelState: () => agentSessionReadModelState,
    useAgentSessions: () => agentSessions,
    useAgentSessionSummaries: () =>
      agentSessions.map((entry) => ({
        externalSessionId: entry.externalSessionId,
        taskId: entry.taskId,
        role: entry.role,
        status: entry.status,
        startedAt: entry.startedAt,
        workingDirectory: entry.workingDirectory,
        pendingApprovals: entry.pendingApprovals,
        pendingQuestions: entry.pendingQuestions,
        selectedModel: entry.selectedModel,
        runtimeKind: entry.runtimeKind,
      })),
    useAgentSession: (externalSessionId: string | null) =>
      externalSessionId
        ? (agentSessions.find((entry) => entry.externalSessionId === externalSessionId) ?? null)
        : null,
    useAgentState: () => ({
      sessions: agentSessions,
      ...agentSessionReadModelState,
      ...agentOperations,
    }),
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

  mock.module("../query-sync/use-agent-studio-query-sync", () => ({
    useAgentStudioQuerySync: () => querySyncState,
  }));

  mock.module("../use-agent-studio-selection-controller", () => ({
    useAgentStudioSelectionController: () => selectionState,
  }));

  mock.module("../query-sync/use-agent-studio-query-session-sync", () => ({
    useAgentStudioQuerySessionSync: () => undefined,
  }));

  mock.module("../use-agent-studio-orchestration-controller", () => ({
    useAgentStudioOrchestrationController: (args: OrchestrationControllerArgs) => {
      orchestrationControllerArgs.push(args);
      return orchestrationState;
    },
  }));

  mock.module("../use-agent-studio-rebase-conflict-resolution", () => ({
    useAgentStudioRebaseConflictResolution: () => ({
      handleResolveRebaseConflict,
    }),
  }));
};

beforeEach(async () => {
  registerModuleMocks();
  ({ useAgentsPageShellModel } = await import("./use-agents-page-shell-model"));
  await restoreMockedModules(mockedModuleResets);
  workspaceState = {
    activeWorkspace: {
      workspaceId: "workspace-repo",
      workspaceName: "Repo",
      repoPath: "/repo",
      isActive: true,
      hasConfig: true,
      configuredWorktreeBasePath: null,
      defaultWorktreeBasePath: "/tmp/default-worktrees",
      effectiveWorktreeBasePath: "/tmp/default-worktrees",
    },
    activeBranch: "main",
    branches: [],
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
    refreshTasks: mock(async () => undefined),
    syncPullRequests: mock(async () => undefined),
    linkMergedPullRequest: mock(async () => undefined),
    cancelLinkMergedPullRequest: mock(() => undefined),
    unlinkPullRequest: mock(async () => undefined),
    createTask: mock(async () => undefined),
    updateTask: mock(async () => undefined),
    setTaskTargetBranch: mock(async () => undefined),
    deleteTask: mock(async () => undefined),
    resetTaskImplementation: mock(async () => undefined),
    resetTask: mock(async () => undefined),
    transitionTask: mock(async () => undefined),
    humanApproveTask: mock(async () => undefined),
    humanRequestChangesTask: mock(async () => undefined),
    detectingPullRequestTaskId: null,
    linkingMergedPullRequestTaskId: null,
    unlinkingPullRequestTaskId: null,
    pendingMergedPullRequest: null,
  };
  const session = createSession();
  agentSessions = [session];
  agentSessionReadModelState = {
    sessionReadModelLoadState: { kind: "idle" },
  };
  agentOperations = {
    loadAgentSessions: mock(async () => undefined),
    loadAgentSessionHistory: mock(async () => undefined),
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
    startAgentSession: mock(async () => sessionIdentity("session-1")),
    sendAgentMessage: mock(async () => undefined),
    stopAgentSession: mock(async () => undefined),
    updateAgentSessionModel: mock(() => undefined),
    replyAgentApproval: mock(async () => undefined),
    answerAgentQuestion: mock(async () => undefined),
  };
  querySyncState = {
    taskIdParam: "task-1",
    sessionKeyParam: selectedSessionKey(),
    hasExplicitRoleParam: false,
    roleFromQuery: "planner",
    launchActionId: "planner_initial",
    isRepoNavigationBoundaryPending: false,
    navigationPersistenceError: new Error("navigation failed"),
    retryNavigationPersistence,
    updateQuery,
  };
  selectionState = {
    view: {
      taskId: "task-1",
      role: "planner",
      launchActionId: "planner_initial",
      selectedTask: task,
      sessionsForTask: [session],
      selectedSessionSummary: session,
      activeSession: session,
      sessionRuntimeData: {
        modelCatalog: null,
        todos: [],
        isLoadingModelCatalog: false,
      },
      sessionRuntimeDataError: null,
      runtimeReadiness: {
        readinessState: "ready",
        isReady: true,
        isRuntimeStarting: false,
        blockedReason: null,
        isLoadingChecks: false,
        refreshChecks: async () => {},
      },
      isTaskReady: true,
      transcriptState: createSelectedSessionTranscriptStateFixture(),
    },
    activeTaskTabId: "task-1",
    taskTabs: [],
    availableTabTasks: [task],
    taskId: "task-1",
    sessionsForTask: [session],
    handleCreateTab: mock((_taskId: string) => {}),
    handleCloseTab: mock((_taskId: string) => {}),
    handleSelectTab,
  };
  orchestrationState = {
    repoSettings: null,
    chatSettingsLoadError: new Error("chat settings failed"),
    retryChatSettingsLoad,
    humanReviewFeedbackModal: {
      ...baseHumanReviewFeedbackModal,
    },
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
  orchestrationControllerArgs = [];
});

afterEach(async () => {
  await restoreMockedModules(mockedModuleResets);
});

const createHookHarness = () =>
  createSharedHookHarness((_: undefined) => useAgentsPageShellModel(), undefined);

describe("useAgentsPageShellModel", () => {
  test("surfaces hook state and wires modal/controller models", async () => {
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
      expect(state.activeWorkspace?.repoPath).toBe("/repo");
      expect(state.navigationPersistenceError).toBe(querySyncState.navigationPersistenceError);
      expect(state.chatSettingsLoadError).toBe(orchestrationState.chatSettingsLoadError);
      expect(state.onRetryNavigationPersistence).toBe(retryNavigationPersistence);
      expect(state.onRetryChatSettingsLoad).toBe(retryChatSettingsLoad);
      expect(state.hasSelectedTask).toBe(true);
      expect(state.isRightPanelVisible).toBe(true);
      expect(state.rightPanelBridge?.rightPanel.selectedView.taskId).toBe(
        selectionState.view.taskId,
      );
      expect(state.rightPanelBridge?.rightPanel.documentsModel).toBe(
        orchestrationState.agentStudioWorkspaceSidebarModel,
      );
      expect(state.modalContent.sessionStartModal).toBe(orchestrationState.sessionStartModal);
      expect(state.modalContent.taskDetailsLauncher.taskDetailsSheetProps.allTasks).toBe(
        tasksState.tasks,
      );
      expect(state.modalContent.humanReviewFeedbackModal).toBe(
        orchestrationState.humanReviewFeedbackModal,
      );
      expect(state.modalContent.mergedPullRequestModal?.pullRequest).toEqual(
        tasksState.pendingMergedPullRequest?.pullRequest ?? null,
      );
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
      view: {
        ...selectionState.view,
        taskId: "",
        selectedTask: null,
      },
    };

    const harness = createHookHarness();

    try {
      await harness.mount();

      const state = harness.getLatest();
      expect(state.hasSelectedTask).toBe(false);
      expect(state.modalContent.sessionStartModal).toBeNull();
      expect(state.modalContent.mergedPullRequestModal).toBeNull();
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
      view: {
        ...selectionState.view,
        taskId: "",
        selectedTask: null,
        selectedSessionSummary: null,
        activeSession: null,
        sessionsForTask: [],
      },
      taskId: "",
      sessionsForTask: [],
    };

    const harness = createHookHarness();

    try {
      await harness.mount();

      const state = harness.getLatest();
      expect(state.activeWorkspace?.repoPath).toBe("/repo");
      expect(state.hasSelectedTask).toBe(false);
      expect(state.isRightPanelVisible).toBe(true);
      expect(state.modalContent.taskDetailsLauncher.taskDetailsSheetRef.current).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("keeps orchestration selection identity stable when inputs do not change", async () => {
    const harness = createHookHarness();

    try {
      await harness.mount();
      const firstSelection = orchestrationControllerArgs.at(-1)?.selection;
      expect(firstSelection).toBeDefined();

      await harness.update(undefined);
      const secondSelection = orchestrationControllerArgs.at(-1)?.selection;
      expect(secondSelection).toBe(firstSelection);

      tasksState = {
        ...tasksState,
        isForegroundLoadingTasks: true,
      };

      await harness.update(undefined);
      const thirdSelection = orchestrationControllerArgs.at(-1)?.selection;
      expect(thirdSelection).not.toBe(firstSelection);
      expect(thirdSelection?.isLoadingTasks).toBe(true);
    } finally {
      await harness.unmount();
    }
  });

  test("keys composer drafts by full selected session identity", async () => {
    const harness = createHookHarness();

    try {
      await harness.mount();

      expect(orchestrationControllerArgs.at(-1)?.draftStateKey).toBe(
        `task-1:planner:${selectedSessionKey()}`,
      );
    } finally {
      await harness.unmount();
    }
  });
});
