import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { createAgentSessionFixture, createTaskCardFixture } from "./agent-studio-test-utils";
import { ROLE_OPTIONS } from "./agents-page-constants";
import { buildRoleLabelByRole } from "./agents-page-view-model";
import { buildAgentStudioSelectedSessionContext } from "./selected-session/selected-session-context";
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
});
const onSelectTab = () => {};
const onCreateTab = () => {};
const onCloseTab = () => {};
const onReorderTab = () => {};
const handleSelectAgentProfile = () => {};
const handleSelectModel = () => {};
const handleSelectVariant = () => {};
const baseReadiness = {
  agentStudioReadinessState: "ready" as const,
  agentStudioReady: true,
  agentStudioBlockedReason: "",
  isLoadingChecks: false,
  refreshChecks: async () => {},
};
const baseSessionActions = {
  handleWorkflowStepSelect: () => {},
  handleSessionSelectionChange: () => {},
  handleCreateSession: () => {},
  handlePrepareMessageFirstSession: () => {},
  handleQuickAction: () => {},
  openTaskDetails: () => {},
  isStarting: false,
  isSending: false,
  isSessionWorking: false,
  isWaitingInput: false,
  busySendBlockedReason: null,
  canKickoffNewSession: false,
  kickoffLabel: "Kickoff",
  canStopSession: false,
  startLaunchKickoff: async () => {},
  onSend: async () => true,
  onSubmitQuestionAnswers: async () => {},
  isSubmittingQuestionByRequestId: {},
  stopAgentSession: async () => {},
};
const baseApprovals = {
  isSubmittingApprovalByRequestId: {},
  approvalReplyErrorByRequestId: {},
  onReplyApproval: async () => {},
};
const baseDocuments = {
  specDoc: taskDocument,
  planDoc: taskDocument,
  qaDoc: taskDocument,
};

const baseArgs: BuildArgs = {
  view: {
    viewTaskId: "task-1",
    contextSwitchVersion: 4,
  },
  selectedSession: buildAgentStudioSelectedSessionContext({
    taskId: "task-1",
    role: "planner",
    selectedTask: task,
    sessionsForTask: [session],
    allSessionSummaries: [session],
    contextSessionsLength: 1,
    activeSession: session,
    runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    sessionRuntimeDataError: null,
    hasActiveGitConflict: false,
    isTaskHydrating: false,
    isSessionHistoryHydrated: true,
    isSessionHistoryHydrating: false,
    isSessionSelectionResolving: false,
    isWaitingForRuntimeReadiness: false,
    isSessionHistoryHydrationFailed: false,
    activeSessionContextUsage: null,
    documents: baseDocuments,
    readiness: baseReadiness,
    sessionActions: baseSessionActions,
    approvals: baseApprovals,
    roleLabelByRole: buildRoleLabelByRole(ROLE_OPTIONS),
  }),
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
  sessionActions: baseSessionActions,
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
    agentProfileOptions: [],
    modelOptions: [],
    modelGroups: [],
    variantOptions: [],
    handleSelectAgentProfile,
    handleSelectModel,
    handleSelectVariant,
    agentAccentColorsByProfileId: {},
    activeSessionContextUsage: null,
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
    expect(mapped.core.runtimeDefinitions).toEqual([OPENCODE_RUNTIME_DESCRIPTOR]);
    expect(mapped.core.isSessionHistoryHydrated).toBe(true);
    expect(mapped.core.isSessionHistoryHydrationFailed).toBe(false);
    expect(mapped.core.isWaitingForRuntimeReadiness).toBe(false);
    expect(mapped.taskTabs.onSelectTab).toBe(onSelectTab);
    expect(mapped.taskTabs.onCreateTab).toBe(onCreateTab);
    expect(mapped.taskTabs.onCloseTab).toBe(onCloseTab);
    expect(mapped.taskTabs.onReorderTab).toBe(onReorderTab);
    expect(mapped.selectedSession.documents.activeDocument?.document.markdown).toBe("# doc");
    expect(mapped.selectedSession.runtime.runtimeReadiness.readinessState).toBe("ready");
    expect(mapped.modelSelection.onSelectAgent).toBe(handleSelectAgentProfile);
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
      selectedSession: {
        ...baseArgs.selectedSession,
        taskId: "",
      },
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
      selectedSession: {
        ...baseArgs.selectedSession,
        runtime: {
          ...baseArgs.selectedSession.runtime,
          isTaskHydrating: true,
        },
      },
    });
    const hydrated = buildAgentStudioPageModelsArgs(baseArgs);
    const noTaskSelected = buildAgentStudioPageModelsArgs({
      ...baseArgs,
      selectedSession: {
        ...baseArgs.selectedSession,
        taskId: "",
        runtime: {
          ...baseArgs.selectedSession.runtime,
          isTaskHydrating: false,
        },
      },
      view: {
        ...baseArgs.view,
        viewTaskId: "",
      },
    });

    expect(hydrating.core.isTaskHydrating).toBe(true);
    expect(hydrated.core.isTaskHydrating).toBe(false);
    expect(noTaskSelected.core.isTaskHydrating).toBe(false);
  });

  test("stops reporting task hydration after hydration fails", () => {
    const failed = buildAgentStudioPageModelsArgs({
      ...baseArgs,
      selectedSession: {
        ...baseArgs.selectedSession,
        runtime: {
          ...baseArgs.selectedSession.runtime,
          isTaskHydrating: false,
        },
      },
    });

    expect(failed.core.isTaskHydrating).toBe(false);
  });

  test("forwards explicit session history hydration failures into page-model core", () => {
    const failed = buildAgentStudioPageModelsArgs({
      ...baseArgs,
      selectedSession: {
        ...baseArgs.selectedSession,
        runtime: {
          ...baseArgs.selectedSession.runtime,
          isSessionHistoryHydrationFailed: true,
        },
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
    });
    const mapped = buildAgentStudioPageModelsArgs({
      ...baseArgs,
      selectedSession: {
        ...baseArgs.selectedSession,
        allSessionSummaries: [session, secondSession],
        sessionsForTask: [session, secondSession],
        contextSessionsLength: 2,
      },
    });

    expect(mapped.core.contextSessionsLength).toBe(2);
  });
});
