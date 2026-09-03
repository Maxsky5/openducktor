import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { DEFAULT_AGENT_RUNTIMES } from "@openducktor/contracts";
import type { PropsWithChildren, ReactElement } from "react";
import type { SessionStartModalModel } from "@/components/features/agents/session-start-modal";
import type { TaskExecutionSelectedFilePreviewModel } from "@/components/features/agents/task-execution-file-preview";
import type { AgentStudioTaskTabsModel } from "@/components/features/agents/agent-studio-task-tabs";
import type { AgentStudioHeaderModel } from "@/components/features/agents/agent-studio-header";
import type { AgentChatModel } from "@/components/features/agents/agent-chat";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { createAgentSessionCollection } from "@/state/agent-session-collection";
import {
  type AgentSessionSummary,
  createAgentSessionsStore,
  toAgentSessionSummary,
} from "@/state/agent-sessions-store";
import {
  AgentOperationsContext,
  AgentSessionsContext,
  ChecksStateContext,
  RuntimeDefinitionsContext,
  TasksStateContext,
  WorkspaceStateContext,
} from "@/state/app-state-contexts";
import type {
  AgentOperationsContextValue,
  ChecksStateContextValue,
  RepoSettingsInput,
  TasksStateContextValue,
  WorkspaceStateContextValue,
} from "@/types/state-slices";
import { agentStudioChatDraftScopeKey } from "../agent-studio-chat-draft";
import {
  createAgentSessionFixture,
  createSelectedSessionTranscriptStateFixture,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "../agent-studio-test-utils";
import type { AgentsPageModalContentModel } from "./agents-page-modal-content";
import type { AgentStudioRightPanelBridgeModel } from "./use-agent-studio-right-panel-bridge";
import type { AgentStudioQueryUpdate } from "../query-sync/agent-studio-navigation";
import type { useAgentStudioSessionActions } from "../use-agent-studio-session-actions";
import {
  createAgentChatModelFixture,
  createAgentStudioHeaderModelFixture,
  createAgentStudioTaskTabsModelFixture,
} from "./use-agents-page-shell-model.test-support";

interface RepoSettingsStateContract {
  repoSettings: RepoSettingsInput | null;
  githubIntegrationEnabled: boolean;
  isLoadingRepoSettings: boolean;
}

enableReactActEnvironment();

const task = createTaskCardFixture({ id: "task-1", title: "Task 1" });
const createSession = () =>
  createAgentSessionFixture({
    externalSessionId: "session-1",
    sessionAssociation: { kind: "workflow", taskId: "task-1", role: "planner" },

    runtimeKind: "opencode",
  });
type SessionFixture = ReturnType<typeof createSession>;
const selectedSessionKey = (): string => agentSessionIdentityKey(createSession());

const retryNavigationPersistence = mock(() => {});
const updateQuery = mock((_updates?: AgentStudioQueryUpdate) => {});
const handleSelectTab = mock((_value: string) => {});
const retryChatSettingsLoad = mock(() => {});
const handleResolveRebaseConflict = mock(async () => true);

type QuerySyncState = {
  taskIdParam: string;
  sessionExternalIdParam: string;
  hasExplicitRoleParam: boolean;
  roleFromQuery: "planner";
  launchActionId: "planner_initial";
  isRepoNavigationBoundaryPending: boolean;
  navigationPersistenceError: Error | null;
  retryNavigationPersistence: typeof retryNavigationPersistence;
  updateQuery: typeof updateQuery;
};

type SelectionState = {
  routeSessionResolution: { kind: "none" };
  selectedSessionFromRoute: null;
  selectedTask: typeof task | null;
  allSessionSummaries: AgentSessionSummary[];
  resolvedRouteSession: AgentSessionSummary | null;
  queryUpdate: AgentStudioQueryUpdate | null;
  isLoadingTasks: boolean;
  view: {
    taskId: string;
    role: "planner";
    launchActionId: "planner_initial";
    selectedTask: typeof task | null;
    sessionsForTask: AgentSessionSummary[];
    selectedSessionSummary: AgentSessionSummary | null;
    selectedSession: {
      identity: ReturnType<typeof sessionIdentity> | null;
      activityState: null;
      selectedModel: null;
      loadedSession: SessionFixture | null;
      runtimeData: {
        modelCatalog: null;
        todos: [];
        isLoadingModelCatalog: false;
        catalogError: null;
        todosError: null;
        runtimePolicyError: null;
        contextError: null;
      };
      runtimeReadiness: {
        state: "ready";
        message: null;
        isLoadingChecks: false;
        refreshChecks: () => Promise<void>;
      };
      transcriptState: ReturnType<typeof createSelectedSessionTranscriptStateFixture>;
      sessionAuxiliaryError: string | null;
    };
    isTaskReady: boolean;
  };
  activeTaskTabId: string;
  loadedStateWorkspaceId: string | null;
  taskTabs: [];
  tabTaskIds: string[];
  availableTabTasks: (typeof task)[];
  taskId: string;
  sessionsForTask: AgentSessionSummary[];
  handleCreateTab: (taskId: string) => void;
  handleCloseTab: (taskId: string) => void;
  handleSelectTab: typeof handleSelectTab;
  handleReorderTab: (
    draggedTaskId: string,
    targetTaskId: string,
    position: "before" | "after",
  ) => void;
};

type OrchestrationState = {
  repoSettings: null;
  chatSettingsLoadError: Error | null;
  retryChatSettingsLoad: typeof retryChatSettingsLoad;
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  sessionStartModal: SessionStartModalModel | null;
  startSessionRequest: ReturnType<typeof useAgentStudioSessionActions>["startSessionRequest"];
  activeTabValue: string;
  agentStudioTaskTabsModel: AgentStudioTaskTabsModel;
  agentStudioHeaderModel: AgentStudioHeaderModel;
  taskExecutionDocumentPanelModel: { activeDocument: null };
  agentChatModel: AgentChatModel;
  rightPanel: {
    tabs: [
      { id: "document"; label: "Document" },
      { id: "git"; label: "Git" },
      { id: "file_explorer"; label: "File explorer" },
    ];
    activeTabId: "document";
    onActiveTabChange: (tabId: "document" | "git" | "file_explorer" | "ci_checks") => void;
    isPanelOpen: boolean;
    rightPanelToggleModel: {
      kind: "task_execution";
      isOpen: boolean;
      onToggle: () => void;
    };
  };
  taskExecutionSelectedFilePreviewModel: TaskExecutionSelectedFilePreviewModel;
  onSelectTaskExecutionFile: (file: { rootPath: string; relativePath: string }) => void;
};
type OrchestrationControllerArgs = {
  selection: ReturnType<
    (typeof import("../use-agent-studio-selection-controller"))["useAgentStudioSelectionController"]
  > & { isLoadingTasks: boolean };
  draftStateKey: string;
};

const agentStudioTaskTabsModel = createAgentStudioTaskTabsModelFixture();
const agentStudioHeaderModel = createAgentStudioHeaderModelFixture();
const agentChatModel = createAgentChatModelFixture();

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
  terminalPanel: { scopeKey: string | null };
};

let workspaceState: Pick<
  WorkspaceStateContextValue,
  "activeWorkspace" | "activeBranch" | "branches"
> = {
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
  activeBranch: { name: "main", detached: false },
  branches: [],
};
let checksState = {
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
  closeTask: mock(async () => undefined),
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
let sessionStore = createAgentSessionsStore("/repo");
let repoSettingsState: RepoSettingsStateContract = {
  repoSettings: null,
  githubIntegrationEnabled: false,
  isLoadingRepoSettings: false,
};
const sessionIdentity = (externalSessionId: string) => ({
  externalSessionId,
  runtimeKind: "opencode" as const,
  workingDirectory: `/repo/worktrees/${externalSessionId}`,
});
let agentOperations: AgentOperationsContextValue = {
  readSessionTodos: mock(async () => []),
  readSessionHistory: mock(async () => []),
  loadAgentSessionHistory: mock(async () => null),
  loadAgentSessionContext: mock(async () => undefined),
  startAgentSession: mock(async () => sessionIdentity("session-1")),
  sendAgentMessage: mock(async () => undefined),
  stopAgentSession: mock(async () => undefined),
  updateAgentSessionModel: mock(async () => undefined),
  replyAgentApproval: mock(async () => undefined),
  answerAgentQuestion: mock(async () => undefined),
};
let querySyncState: QuerySyncState = {
  taskIdParam: "task-1",
  sessionExternalIdParam: selectedSessionKey(),
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
  routeSessionResolution: { kind: "none" },
  selectedSessionFromRoute: null,
  selectedTask: task,
  allSessionSummaries: [toAgentSessionSummary(initialSelectionSession)],
  resolvedRouteSession: null,
  queryUpdate: null,
  isLoadingTasks: false,
  view: {
    taskId: "task-1",
    role: "planner" as const,
    launchActionId: "planner_initial" as const,
    selectedTask: task,
    sessionsForTask: [toAgentSessionSummary(initialSelectionSession)],
    selectedSessionSummary: toAgentSessionSummary(initialSelectionSession),
    selectedSession: {
      identity: null,
      activityState: null,
      selectedModel: null,
      loadedSession: initialSelectionSession,
      runtimeData: {
        modelCatalog: null,
        todos: [],
        isLoadingModelCatalog: false,
        catalogError: null,
        todosError: null,
        runtimePolicyError: null,
        contextError: null,
      },
      runtimeReadiness: {
        state: "ready",
        message: null,
        isLoadingChecks: false,
        refreshChecks: async () => {},
      },
      transcriptState: createSelectedSessionTranscriptStateFixture(),
      sessionAuxiliaryError: null,
    },
    isTaskReady: true,
  },
  activeTaskTabId: "task-1",
  loadedStateWorkspaceId: "workspace-repo",
  taskTabs: [],
  tabTaskIds: ["task-1"],
  availableTabTasks: [task],
  taskId: "task-1",
  sessionsForTask: [toAgentSessionSummary(initialSelectionSession)],
  handleCreateTab: mock((_taskId: string) => {}),
  handleCloseTab: mock((_taskId: string) => {}),
  handleSelectTab,
  handleReorderTab: mock(() => {}),
};
const rightPanelToggleModel = {
  kind: "task_execution" as const,
  isOpen: true,
  onToggle: () => {},
};
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
  modelPickerRuntimes: [],
  favoriteState: {
    favorites: [],
    isLoading: false,
    readError: null,
    isMutationPending: false,
    mutationError: null,
    canMutate: true,
    toggleFavorite: mock(() => {}),
    retryRead: mock(() => {}),
    retryMutation: mock(() => {}),
  },
  supportsProfiles: true,
  supportsVariants: true,
  selectionCatalogError: null,
  isSelectionCatalogLoading: false,
  runtimeDefinitionsError: null,
  isRuntimeDefinitionsLoading: false,
  onRetryRuntimeDefinitions: () => {},
  runtimeSettingsError: null,
  isRuntimeSettingsLoading: false,
  hasRuntimeSettingsSnapshot: true,
  onRetryRuntimeSettings: () => {},
  runtimeProfileOptions: [],
  variantOptions: [],
  availableStartModes: ["fresh"],
  selectedStartMode: "fresh",
  existingSessionOptions: [],
  selectedSourceSessionValue: "",
  onSelectStartMode: mock(() => {}),
  onSelectSourceSessionValue: mock(() => {}),
  onSelectRuntimeProfile: mock(() => {}),
  onSelectModelPair: mock(() => {}),
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
  agentStudioTaskTabsModel,
  agentStudioHeaderModel,
  taskExecutionDocumentPanelModel: { activeDocument: null },
  agentChatModel,
  rightPanel: {
    tabs: [
      { id: "document", label: "Document" },
      { id: "git", label: "Git" },
      { id: "file_explorer", label: "File explorer" },
    ],
    activeTabId: "document",
    onActiveTabChange: mock(() => {}),
    isPanelOpen: true,
    rightPanelToggleModel,
  },
  taskExecutionSelectedFilePreviewModel: {
    selectedFile: null,
    previewSessionKey: 0,
    preservePreviousSnapshot: false,
    hasPendingDiscard: false,
    onClose: mock(() => {}),
    onLeavePolicyChange: () => {},
    onKeepEditing: () => {},
    onDiscard: () => {},
  },
  onSelectTaskExecutionFile: mock(() => {}),
};
let orchestrationControllerArgs: OrchestrationControllerArgs[] = [];
type OrchestrationShellArgs = Parameters<
  typeof orchestrationShellModule.useAgentsPageOrchestrationShellModel
>[0];
type OrchestrationSelection = OrchestrationShellArgs["routeSession"]["selection"] & {
  isLoadingTasks: boolean;
};

let lastOrchestrationSelectionSource: OrchestrationShellArgs["routeSession"]["selection"] | null =
  null;
let lastOrchestrationSelectionLoadingTasks: boolean | null = null;
let lastOrchestrationSelection: OrchestrationSelection | null = null;
let useAgentsPageShellModel: () => AgentsPageShellModelState;

const syncAgentSessionsStore = (): void => {
  sessionStore.setSessionCollection(() => createAgentSessionCollection(agentSessions));
};

const workspaceStateValue = (): WorkspaceStateContextValue => ({
  isSwitchingWorkspace: false,
  isLoadingBranches: false,
  isSwitchingBranch: false,
  branchSyncDegraded: false,
  workspaces: [],
  addWorkspace: async () => undefined,
  selectWorkspace: async () => undefined,
  reorderWorkspaces: async () => undefined,
  refreshBranches: async () => undefined,
  switchBranch: async () => undefined,
  loadRepoSettings: async () => {
    if (!repoSettingsState.repoSettings) {
      throw new Error("repo settings are not available");
    }
    return repoSettingsState.repoSettings;
  },
  saveRepoSettings: async () => undefined,
  loadSettingsSnapshot: async () => {
    throw new Error("loadSettingsSnapshot is not used in this test");
  },
  detectGithubRepository: async () => null,
  saveGlobalGitConfig: async () => undefined,
  saveSettingsSnapshot: async () => undefined,
  saveAgentModelFavorites: async () => {
    throw new Error("saveAgentModelFavorites is not used in this test");
  },
  ...workspaceState,
});

const checksStateValue = (): ChecksStateContextValue => ({
  runtimeCheck: null,
  taskStoreCheck: null,
  runtimeCheckFailureKind: null,
  taskStoreCheckFailureKind: null,
  ...checksState,
});

const runtimeDefinitionsValue = () => ({
  runtimeDefinitions: [],
  availableRuntimeDefinitions: [],
  agentRuntimes: DEFAULT_AGENT_RUNTIMES,
  isLoadingRuntimeDefinitions: false,
  runtimeDefinitionsError: null,
  isLoadingRuntimeSettings: false,
  runtimeSettingsError: null,
  hasRuntimeSettingsSnapshot: true,
  refreshRuntimeSettings: async () => {},
  refreshRuntimeDefinitions: async () => [],
  loadRepoRuntimeCatalog: async () => ({
    providers: [],
    models: [],
    variants: [],
    profiles: [],
    defaultModelsByProvider: {},
  }),
  loadRepoRuntimeSlashCommands: async () => ({ commands: [] }),
  loadRepoRuntimeSkills: async () => ({ skills: [] }),
  loadRepoRuntimeSubagents: async () => ({ subagents: [] }),
  loadRepoRuntimeFileSearch: async () => [],
});

const AppStateTestWrapper = ({ children }: PropsWithChildren): ReactElement => (
  <WorkspaceStateContext.Provider value={workspaceStateValue()}>
    <ChecksStateContext.Provider value={checksStateValue()}>
      <TasksStateContext.Provider value={tasksState}>
        <AgentOperationsContext.Provider value={agentOperations}>
          <AgentSessionsContext.Provider value={sessionStore}>
            <RuntimeDefinitionsContext.Provider value={runtimeDefinitionsValue()}>
              {children}
            </RuntimeDefinitionsContext.Provider>
          </AgentSessionsContext.Provider>
        </AgentOperationsContext.Provider>
      </TasksStateContext.Provider>
    </ChecksStateContext.Provider>
  </WorkspaceStateContext.Provider>
);

const repoSettingsModule = await import("../use-agent-studio-repo-settings");
const routeSessionModule = await import("./use-agents-page-route-session-model");
const orchestrationShellModule = await import("./use-agents-page-orchestration-shell-model");
let shellModelSpies: Array<{ mockRestore(): void }> = [];

const registerModuleMocks = (): void => {
  shellModelSpies = [
    spyOn(routeSessionModule, "useAgentsPageRouteSessionModel").mockImplementation(() => ({
      navigationPersistenceError: querySyncState.navigationPersistenceError,
      retryNavigationPersistence: querySyncState.retryNavigationPersistence,
      scheduleQueryUpdate: querySyncState.updateQuery,
      selection: selectionState,
      selectAgentStudioSelection: mock(() => {}),
      taskExecutionFilePreview: {
        model: {
          selectedFile: null,
          previewSessionKey: 0,
          preservePreviousSnapshot: false,
          hasPendingDiscard: false,
          onClose: () => {},
          onLeavePolicyChange: () => {},
          onKeepEditing: () => {},
          onDiscard: () => {},
        },
        onSelectFile: () => undefined,
        requestContextTransition: (applyTransition) => applyTransition(),
      },
    })),
    spyOn(repoSettingsModule, "useAgentStudioRepoSettings").mockImplementation(
      () => repoSettingsState,
    ),
    spyOn(orchestrationShellModule, "useAgentsPageOrchestrationShellModel").mockImplementation(
      ({ activeWorkspaceId, isForegroundLoadingTasks, routeSession }: OrchestrationShellArgs) => {
        if (
          lastOrchestrationSelectionSource !== routeSession.selection ||
          lastOrchestrationSelectionLoadingTasks !== isForegroundLoadingTasks
        ) {
          lastOrchestrationSelectionSource = routeSession.selection;
          lastOrchestrationSelectionLoadingTasks = isForegroundLoadingTasks;
          lastOrchestrationSelection = {
            ...routeSession.selection,
            isLoadingTasks: isForegroundLoadingTasks,
          };
        }

        const draftScope = {
          taskId: routeSession.selection.view.taskId,
          role: routeSession.selection.view.role,
          session: routeSession.selection.view.selectedSession.identity,
        };
        const draftStateKey = agentStudioChatDraftScopeKey(activeWorkspaceId, draftScope);

        if (!lastOrchestrationSelection) {
          throw new Error("Missing orchestration selection");
        }

        orchestrationControllerArgs.push({
          selection: lastOrchestrationSelection,
          draftStateKey,
        });

        return {
          orchestration: orchestrationState,
          orchestrationSelection: lastOrchestrationSelection,
          handleResolveRebaseConflict,
          agentStudioHeaderModel: orchestrationState.agentStudioHeaderModel,
        };
      },
    ),
  ];
};

beforeEach(async () => {
  registerModuleMocks();
  ({ useAgentsPageShellModel } = await import("./use-agents-page-shell-model"));
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
    activeBranch: { name: "main", detached: false },
    branches: [],
  };
  checksState = {
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
    closeTask: mock(async () => undefined),
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
  sessionStore = createAgentSessionsStore("/repo");
  syncAgentSessionsStore();
  repoSettingsState = {
    repoSettings: null,
    githubIntegrationEnabled: false,
    isLoadingRepoSettings: false,
  };
  agentOperations = {
    readSessionTodos: mock(async () => []),
    readSessionHistory: mock(async () => []),
    loadAgentSessionHistory: mock(async () => null),
    loadAgentSessionContext: mock(async () => undefined),
    startAgentSession: mock(async () => sessionIdentity("session-1")),
    sendAgentMessage: mock(async () => undefined),
    stopAgentSession: mock(async () => undefined),
    updateAgentSessionModel: mock(async () => undefined),
    replyAgentApproval: mock(async () => undefined),
    answerAgentQuestion: mock(async () => undefined),
  };
  querySyncState = {
    taskIdParam: "task-1",
    sessionExternalIdParam: selectedSessionKey(),
    hasExplicitRoleParam: false,
    roleFromQuery: "planner",
    launchActionId: "planner_initial",
    isRepoNavigationBoundaryPending: false,
    navigationPersistenceError: new Error("navigation failed"),
    retryNavigationPersistence,
    updateQuery,
  };
  selectionState = {
    routeSessionResolution: { kind: "none" },
    selectedSessionFromRoute: null,
    selectedTask: task,
    allSessionSummaries: [toAgentSessionSummary(session)],
    resolvedRouteSession: null,
    queryUpdate: null,
    isLoadingTasks: false,
    view: {
      taskId: "task-1",
      role: "planner",
      launchActionId: "planner_initial",
      selectedTask: task,
      sessionsForTask: [toAgentSessionSummary(session)],
      selectedSessionSummary: toAgentSessionSummary(session),
      selectedSession: {
        identity: null,
        activityState: null,
        selectedModel: null,
        loadedSession: session,
        runtimeData: {
          modelCatalog: null,
          todos: [],
          isLoadingModelCatalog: false,
          catalogError: null,
          todosError: null,
          runtimePolicyError: null,
          contextError: null,
        },
        runtimeReadiness: {
          state: "ready",
          message: null,
          isLoadingChecks: false,
          refreshChecks: async () => {},
        },
        transcriptState: createSelectedSessionTranscriptStateFixture(),
        sessionAuxiliaryError: null,
      },
      isTaskReady: true,
    },
    activeTaskTabId: "task-1",
    loadedStateWorkspaceId: "workspace-repo",
    taskTabs: [],
    tabTaskIds: ["task-1"],
    availableTabTasks: [task],
    taskId: "task-1",
    sessionsForTask: [toAgentSessionSummary(session)],
    handleCreateTab: mock((_taskId: string) => {}),
    handleCloseTab: mock((_taskId: string) => {}),
    handleSelectTab,
    handleReorderTab: mock(() => {}),
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
    agentStudioTaskTabsModel,
    agentStudioHeaderModel,
    taskExecutionDocumentPanelModel: { activeDocument: null },
    agentChatModel,
    rightPanel: {
      tabs: [
        { id: "document", label: "Document" },
        { id: "git", label: "Git" },
        { id: "file_explorer", label: "File explorer" },
      ],
      activeTabId: "document",
      onActiveTabChange: mock(() => {}),
      isPanelOpen: true,
      rightPanelToggleModel,
    },
    taskExecutionSelectedFilePreviewModel: {
      selectedFile: null,
      previewSessionKey: 0,
      preservePreviousSnapshot: false,
      hasPendingDiscard: false,
      onClose: mock(() => {}),
      onLeavePolicyChange: () => {},
      onKeepEditing: () => {},
      onDiscard: () => {},
    },
    onSelectTaskExecutionFile: mock(() => {}),
  };
  orchestrationControllerArgs = [];
  lastOrchestrationSelectionSource = null;
  lastOrchestrationSelectionLoadingTasks = null;
  lastOrchestrationSelection = null;
});

afterEach(() => {
  for (const shellModelSpy of shellModelSpies) shellModelSpy.mockRestore();
  shellModelSpies = [];
});

const createHookHarness = () =>
  createSharedHookHarness(() => useAgentsPageShellModel(), undefined, {
    wrapper: AppStateTestWrapper,
  });

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
        orchestrationState.taskExecutionDocumentPanelModel,
      );
      expect(state.modalContent.sessionStartModal).toBe(orchestrationState.sessionStartModal);
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
      tabTaskIds: [],
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

  test("keeps the active terminal scope while the selected task card loads", async () => {
    selectionState = {
      ...selectionState,
      activeTaskTabId: "task-2",
      tabTaskIds: ["task-1", "task-2"],
      taskId: "task-2",
      view: {
        ...selectionState.view,
        taskId: "task-2",
        selectedTask: null,
      },
    };
    const harness = createHookHarness();

    try {
      await harness.mount();

      expect(harness.getLatest().terminalPanel.scopeKey).toBe(
        JSON.stringify(["workspace-repo", "task-2"]),
      );
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
      tabTaskIds: [],
      view: {
        ...selectionState.view,
        taskId: "",
        selectedTask: null,
        selectedSessionSummary: null,
        selectedSession: {
          ...selectionState.view.selectedSession,
          loadedSession: null,
        },
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

      selectionState = {
        ...selectionState,
        tabTaskIds: ["task-2"],
        view: {
          ...selectionState.view,
          taskId: "task-2",
        },
        taskId: "task-2",
      };

      await harness.update(undefined);
      const thirdSelection = orchestrationControllerArgs.at(-1)?.selection;
      expect(thirdSelection).not.toBe(firstSelection);
      expect(thirdSelection?.view.taskId).toBe("task-2");
    } finally {
      await harness.unmount();
    }
  });

  test("keys composer drafts by full selected session identity", async () => {
    selectionState = {
      ...selectionState,
      view: {
        ...selectionState.view,
        selectedSession: {
          ...selectionState.view.selectedSession,
          identity: {
            externalSessionId: initialSelectionSession.externalSessionId,
            runtimeKind: "opencode",
            workingDirectory: initialSelectionSession.workingDirectory,
          },
        },
      },
    };
    const harness = createHookHarness();

    try {
      await harness.mount();

      expect(orchestrationControllerArgs.at(-1)?.draftStateKey).toBe(
        `workspace-repo:task-1:planner:${selectedSessionKey()}`,
      );
    } finally {
      await harness.unmount();
    }
  });
});
