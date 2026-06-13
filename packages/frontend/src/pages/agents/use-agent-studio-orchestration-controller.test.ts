import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import {
  createAgentSessionFixture,
  createSelectedSessionLifecycleFixture,
  createTaskCardFixture,
} from "./agent-studio-test-utils";
import { ROLE_OPTIONS } from "./agents-page-constants";
import { buildRoleLabelByRole } from "./agents-page-view-model";
import { buildAgentStudioSelectedSessionContext } from "./selected-session/selected-session-context";
import {
  buildAgentStudioPageModelsArgs,
  buildAgentStudioSelectedSessionContextFromOrchestration,
} from "./use-agent-studio-orchestration-controller";

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
  isRuntimeStarting: false,
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
  },
  selectedSession: buildAgentStudioSelectedSessionContext({
    taskId: "task-1",
    role: "planner",
    selectedTask: task,
    sessionsForTask: [session],
    allSessionSummaries: [session],
    activeSession: session,
    runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    sessionRuntimeDataError: null,
    hasActiveGitConflict: false,
    lifecycle: createSelectedSessionLifecycleFixture(),
    isViewSwitching: false,
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
    supportsSkillReferences: false,
    slashCommandCatalog: { commands: [] },
    slashCommands: [],
    slashCommandsError: null,
    isSlashCommandsLoading: false,
    skillCatalog: { skills: [] },
    skills: [],
    skillsError: null,
    isSkillsLoading: false,
    searchFiles: async () => [],
    agentProfileOptions: [],
    modelOptions: [],
    modelGroups: [],
    variantOptions: [],
    handleSelectAgentProfile,
    handleSelectModel,
    handleSelectVariant,
    agentAccentColorsByProfileId: {},
  },
  chatSettings: {
    showThinkingMessages: true,
    expandFileDiffsByDefault: false,
  },
  composer: {
    draftStateKey: "draft-1",
  },
};

describe("buildAgentStudioPageModelsArgs", () => {
  test("maps grouped orchestration context into page-model contracts", () => {
    const mapped = buildAgentStudioPageModelsArgs(baseArgs);

    expect(mapped.activeTabValue).toBe("task-1");
    expect(mapped.selectedSession.role).toBe("planner");
    expect(mapped.selectedSession.runtime.runtimeDefinitions).toEqual([
      OPENCODE_RUNTIME_DESCRIPTOR,
    ]);
    expect(mapped.selectedSession.runtime.lifecycle.canRenderHistory).toBe(true);
    expect(mapped.selectedSession.runtime.lifecycle.isHistoryLoadFailed).toBe(false);
    expect(mapped.selectedSession.runtime.lifecycle.isWaitingForRuntimeReadiness).toBe(false);
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
    expect(mapped.chatSettings.expandFileDiffsByDefault).toBe(false);
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

    expect(withActiveTab.activeTabValue).toBe("task-tab-2");
    expect(withTaskFallback.activeTabValue).toBe("task-1");
    expect(withEmptyFallback.activeTabValue).toBe("__agent_studio_empty__");
  });
});

describe("buildAgentStudioSelectedSessionContextFromOrchestration", () => {
  test("maps raw orchestration inputs into selected-session context", () => {
    const context = buildAgentStudioSelectedSessionContextFromOrchestration({
      taskId: "task-1",
      role: "planner",
      selectedTask: task,
      sessionsForTask: [session],
      allSessionSummaries: [session],
      activeSession: session,
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      viewSessionRuntimeDataError: "runtime data failed",
      hasActiveGitConflict: true,
      isActiveTaskReady: false,
      isActiveTaskReadinessFailed: false,
      isSessionSelectionResolving: true,
      viewSessionLifecycle: createSelectedSessionLifecycleFixture({
        phase: "loading_history",
        canRenderHistory: false,
        isLoadingHistory: true,
        isWaitingForRuntimeReadiness: true,
      }),
      activeSessionContextUsage: { totalTokens: 64, contextWindow: 1024 },
      documents: baseDocuments,
      readiness: {
        ...baseReadiness,
        agentStudioReadinessState: "checking",
        agentStudioReady: false,
      },
      sessionActions: {
        ...baseSessionActions,
        canKickoffNewSession: true,
      },
      approvals: baseApprovals,
      roleLabelByRole: buildRoleLabelByRole(ROLE_OPTIONS),
    });

    expect(context.chat.isViewSwitching).toBe(true);
    expect(context.runtime.sessionRuntimeDataError).toBe("runtime data failed");
    expect(context.runtime.runtimeReadiness.readinessState).toBe("checking");
    expect(context.runtime.lifecycle.isLoadingHistory).toBe(true);
    expect(context.runtime.lifecycle.isWaitingForRuntimeReadiness).toBe(true);
    expect(context.chat.contextUsage).toEqual({ totalTokens: 64, contextWindow: 1024 });
    expect(context.workflow.selectedInteractionRole).toBe("planner");
    expect(context.documents.activeDocument?.title).toBe("Implementation Plan");
    expect(context.rightPanel).toMatchObject({
      role: "planner",
      hasTaskContext: true,
      hasDocumentPanel: true,
      hasBuildToolsPanel: false,
    });
  });

  test("forwards selected-session runtime state without recomputing it", () => {
    const failed = buildAgentStudioPageModelsArgs({
      ...baseArgs,
      selectedSession: {
        ...baseArgs.selectedSession,
        runtime: {
          ...baseArgs.selectedSession.runtime,
          lifecycle: createSelectedSessionLifecycleFixture({
            isHistoryLoadFailed: true,
            phase: "history_failed",
          }),
        },
        chat: {
          ...baseArgs.selectedSession.chat,
          isViewSwitching: true,
        },
      },
    });

    expect(failed.selectedSession.chat.isViewSwitching).toBe(true);
    expect(failed.selectedSession.runtime.lifecycle.isHistoryLoadFailed).toBe(true);
  });
});
