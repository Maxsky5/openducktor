import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture, createTaskCardFixture } from "./agent-studio-test-utils";
import { buildAgentStudioPageModelsArgs } from "./use-agent-studio-orchestration-controller";

type BuildArgs = Parameters<typeof buildAgentStudioPageModelsArgs>[0];

const taskDocument = {
  markdown: "# doc",
  updatedAt: "2026-02-22T10:00:00.000Z",
  isLoading: false,
  error: null,
  loaded: true,
};

const task = createTaskCardFixture({ id: "task-1", title: "Task 1" });
const session = createAgentSessionFixture({
  runtimeKind: "opencode",
  externalSessionId: "session-1",
  taskId: "task-1",
  role: "planner",
  scenario: "planner_initial",
});
const onSelectTab = () => {};
const onCreateTab = () => {};
const onCloseTab = () => {};
const onReorderTab = () => {};
const handleSelectAgent = () => {};
const handleSelectModel = () => {};
const handleSelectVariant = () => {};

const baseArgs: BuildArgs = {
  view: {
    viewTaskId: "task-1",
    viewRole: "planner",
    viewSelectedTask: task,
    contextSwitchVersion: 4,
    isActiveTaskHydrated: true,
    isActiveTaskHydrationFailed: false,
    isViewSessionHistoryHydrated: true,
    isViewSessionHistoryHydrationFailed: false,
    isViewSessionHistoryHydrating: false,
    isViewSessionWaitingForRuntimeReadiness: false,
  },
  sessions: {
    allSessionSummaries: [session],
    viewSessionsForTask: [session],
    viewActiveSession: session,
  },
  tabs: {
    activeTaskTabId: "task-1",
    taskTabs: [],
    availableTabTasks: [task],
    isLoadingTasks: false,
    handleSelectTab: onSelectTab,
    handleCreateTab: onCreateTab,
    handleCloseTab: onCloseTab,
    handleReorderTab: onReorderTab,
  },
  documents: {
    specDoc: taskDocument,
    planDoc: taskDocument,
    qaDoc: taskDocument,
  },
  readiness: {
    agentStudioReadinessState: "ready",
    agentStudioReady: true,
    agentStudioBlockedReason: "",
    isLoadingChecks: false,
    refreshChecks: async () => {},
  },
  sessionActions: {
    handleWorkflowStepSelect: () => {},
    handleSessionSelectionChange: () => {},
    handleCreateSession: () => {},
    openTaskDetails: () => {},
    isStarting: false,
    isSending: false,
    isSessionWorking: false,
    isWaitingInput: false,
    busySendBlockedReason: null,
    canKickoffNewSession: false,
    kickoffLabel: "Kickoff",
    canStopSession: false,
    startScenarioKickoff: async () => {},
    onSend: async () => true,
    onSubmitQuestionAnswers: async () => {},
    isSubmittingQuestionByRequestId: {},
    stopAgentSession: async () => {},
  },
  modelSelection: {
    selectedModelSelection: null,
    selectedModelDescriptor: null,
    isSelectionCatalogLoading: false,
    supportsSlashCommands: true,
    supportsFileSearch: true,
    slashCommandCatalog: { commands: [] },
    slashCommands: [],
    slashCommandsError: null,
    isSlashCommandsLoading: false,
    searchFiles: async () => [],
    agentOptions: [],
    modelOptions: [],
    modelGroups: [],
    variantOptions: [],
    handleSelectAgent,
    handleSelectModel,
    handleSelectVariant,
    activeSessionAgentColors: {},
    activeSessionContextUsage: null,
  },
  permissions: {
    isSubmittingPermissionByRequestId: {},
    permissionReplyErrorByRequestId: {},
    onReplyPermission: async () => {},
  },
  chatSettings: {
    showThinkingMessages: true,
  },
  composer: {
    draftStateKey: "draft-1",
  },
};

describe("buildAgentStudioPageModelsArgs", () => {
  test("maps grouped orchestration context into page-model contracts", () => {
    const mapped = buildAgentStudioPageModelsArgs(baseArgs);

    expect(mapped.core.role).toBe("planner");
    expect(mapped.core.contextSwitchVersion).toBe(4);
    expect(mapped.core.isSessionHistoryHydrated).toBe(true);
    expect(mapped.core.isSessionHistoryHydrationFailed).toBe(false);
    expect(mapped.core.isWaitingForRuntimeReadiness).toBe(false);
    expect(mapped.taskTabs.onSelectTab).toBe(onSelectTab);
    expect(mapped.taskTabs.onCreateTab).toBe(onCreateTab);
    expect(mapped.taskTabs.onCloseTab).toBe(onCloseTab);
    expect(mapped.taskTabs.onReorderTab).toBe(onReorderTab);
    expect(mapped.documents.planDoc.markdown).toBe("# doc");
    expect(mapped.readiness.agentStudioReadinessState).toBe("ready");
    expect(mapped.modelSelection.onSelectAgent).toBe(handleSelectAgent);
    expect(mapped.modelSelection.onSelectModel).toBe(handleSelectModel);
    expect(mapped.modelSelection.onSelectVariant).toBe(handleSelectVariant);
    expect(mapped.chatSettings.showThinkingMessages).toBe(true);
    expect(mapped.composer.draftStateKey).toBe("draft-1");
  });

  test("derives activeTabValue from tab id, task id, then empty sentinel", () => {
    const withActiveTab = buildAgentStudioPageModelsArgs({
      ...baseArgs,
      tabs: {
        ...baseArgs.tabs,
        activeTaskTabId: "task-tab-2",
      },
    });
    const withTaskFallback = buildAgentStudioPageModelsArgs({
      ...baseArgs,
      tabs: {
        ...baseArgs.tabs,
        activeTaskTabId: "",
      },
    });
    const withEmptyFallback = buildAgentStudioPageModelsArgs({
      ...baseArgs,
      view: {
        ...baseArgs.view,
        viewTaskId: "",
      },
      tabs: {
        ...baseArgs.tabs,
        activeTaskTabId: "",
      },
    });

    expect(withActiveTab.core.activeTabValue).toBe("task-tab-2");
    expect(withTaskFallback.core.activeTabValue).toBe("task-1");
    expect(withEmptyFallback.core.activeTabValue).toBe("__agent_studio_empty__");
  });

  test("derives isTaskHydrating only when a task exists and hydration is incomplete", () => {
    const hydrating = buildAgentStudioPageModelsArgs({
      ...baseArgs,
      view: {
        ...baseArgs.view,
        isActiveTaskHydrated: false,
      },
    });
    const hydrated = buildAgentStudioPageModelsArgs(baseArgs);
    const noTaskSelected = buildAgentStudioPageModelsArgs({
      ...baseArgs,
      view: {
        ...baseArgs.view,
        viewTaskId: "",
        isActiveTaskHydrated: false,
      },
    });

    expect(hydrating.core.isTaskHydrating).toBe(true);
    expect(hydrated.core.isTaskHydrating).toBe(false);
    expect(noTaskSelected.core.isTaskHydrating).toBe(false);
  });

  test("stops reporting task hydration after hydration fails", () => {
    const failed = buildAgentStudioPageModelsArgs({
      ...baseArgs,
      view: {
        ...baseArgs.view,
        isActiveTaskHydrated: false,
        isActiveTaskHydrationFailed: true,
      },
    });

    expect(failed.core.isTaskHydrating).toBe(false);
  });

  test("forwards explicit session history hydration failures into page-model core", () => {
    const failed = buildAgentStudioPageModelsArgs({
      ...baseArgs,
      view: {
        ...baseArgs.view,
        isViewSessionHistoryHydrationFailed: true,
      },
    });

    expect(failed.core.isSessionHistoryHydrationFailed).toBe(true);
  });

  test("derives contextSessionsLength from the sessions context size", () => {
    const secondSession = createAgentSessionFixture({
      runtimeKind: "opencode",
      externalSessionId: "session-2",
      taskId: "task-1",
      role: "planner",
      scenario: "planner_initial",
    });
    const mapped = buildAgentStudioPageModelsArgs({
      ...baseArgs,
      sessions: {
        ...baseArgs.sessions,
        allSessionSummaries: [session, secondSession],
        viewSessionsForTask: [session, secondSession],
      },
    });

    expect(mapped.core.contextSessionsLength).toBe(2);
  });
});
