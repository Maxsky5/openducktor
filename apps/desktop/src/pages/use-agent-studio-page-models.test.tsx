import { describe, expect, mock, test } from "bun:test";
import type { TaskDocumentState } from "@/components/features/task-details/use-task-documents";
import {
  createAgentSessionFixture,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioPageModels } from "./use-agent-studio-page-models";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioPageModels>[0];
type HookState = ReturnType<typeof useAgentStudioPageModels>;

const createTask = () =>
  createTaskCardFixture({
    documentSummary: {
      spec: { has: true },
      plan: { has: false },
      qaReport: { has: false },
    },
  });

const createSession = (sessionId = "session-1", externalSessionId = "external-1") =>
  createAgentSessionFixture({
    sessionId,
    externalSessionId,
    status: "running",
  });

const createDocumentState = (markdown: string): TaskDocumentState => ({
  markdown,
  updatedAt: null,
  isLoading: false,
  error: null,
  loaded: true,
});

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioPageModels, initialProps);

describe("useAgentStudioPageModels", () => {
  test("builds page models and forwards wrapper callbacks", async () => {
    const onRefreshChecks = mock(async () => {});
    const onKickoff = mock(async () => {});
    const onSend = mock(async () => {});
    const onStopSession = mock(async () => {});

    const harness = createHookHarness({
      taskId: "task-1",
      role: "spec",
      selectedTask: createTask(),
      sessionsForTask: [createSession()],
      contextSessionsLength: 1,
      activeSession: createSession(),
      taskTabs: [{ taskId: "task-1", taskTitle: "Task 1", status: "idle", isActive: true }],
      availableTabTasks: [createTask()],
      isLoadingTasks: false,
      onCreateTab: () => {},
      onCloseTab: () => {},
      handleWorkflowStepSelect: () => {},
      handleSessionSelectionChange: () => {},
      handleCreateSession: () => {},
      specDoc: createDocumentState("spec"),
      planDoc: createDocumentState(""),
      qaDoc: createDocumentState(""),
      agentStudioReady: true,
      agentStudioBlockedReason: "",
      isLoadingChecks: false,
      refreshChecks: onRefreshChecks,
      isStarting: false,
      isSending: false,
      isSessionWorking: true,
      canKickoffNewSession: false,
      kickoffLabel: "Start Spec",
      canStopSession: true,
      startScenarioKickoff: onKickoff,
      onSend,
      onSubmitQuestionAnswers: async () => {},
      isSubmittingQuestionByRequestId: {},
      selectedModelSelection: null,
      isSelectionCatalogLoading: false,
      agentOptions: [{ value: "spec", label: "Spec" }],
      modelOptions: [],
      modelGroups: [],
      variantOptions: [],
      onSelectAgent: () => {},
      onSelectModel: () => {},
      onSelectVariant: () => {},
      activeSessionAgentColors: {},
      activeSessionContextUsage: { totalTokens: 12, contextWindow: 100 },
      isSubmittingPermissionByRequestId: {},
      permissionReplyErrorByRequestId: {},
      onReplyPermission: async () => {},
      input: "message",
      setInput: () => {},
      stopAgentSession: onStopSession,
    });

    await harness.mount();

    const state = harness.getLatest();
    expect(state.activeTabValue).toBe("task-1");
    expect(state.agentStudioTaskTabsModel.tabs).toHaveLength(1);
    expect(state.agentStudioHeaderModel.taskId).toBe("task-1");
    expect(state.agentChatModel.composer.contextUsage).toEqual({
      totalTokens: 12,
      contextWindow: 100,
    });

    state.agentChatModel.thread.onRefreshChecks();
    state.agentChatModel.thread.onKickoff();
    state.agentChatModel.composer.onSend();
    state.agentChatModel.composer.onStopSession();

    expect(onRefreshChecks).toHaveBeenCalledTimes(1);
    expect(onKickoff).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onStopSession).toHaveBeenCalledTimes(1);

    await harness.unmount();
  });

  test("tracks todo panel collapse state per active session", async () => {
    const sessionA = createSession("session-a", "external-a");
    const sessionB = createSession("session-b", "external-b");
    const commonProps: Omit<HookArgs, "sessionsForTask" | "activeSession"> = {
      taskId: "task-1",
      role: "spec",
      selectedTask: createTask(),
      contextSessionsLength: 2,
      taskTabs: [{ taskId: "task-1", taskTitle: "Task 1", status: "idle", isActive: true }],
      availableTabTasks: [createTask()],
      isLoadingTasks: false,
      onCreateTab: () => {},
      onCloseTab: () => {},
      handleWorkflowStepSelect: () => {},
      handleSessionSelectionChange: () => {},
      handleCreateSession: () => {},
      specDoc: createDocumentState("spec"),
      planDoc: createDocumentState(""),
      qaDoc: createDocumentState(""),
      agentStudioReady: true,
      agentStudioBlockedReason: "",
      isLoadingChecks: false,
      refreshChecks: async () => {},
      isStarting: false,
      isSending: false,
      isSessionWorking: false,
      canKickoffNewSession: false,
      kickoffLabel: "Start Spec",
      canStopSession: true,
      startScenarioKickoff: async () => {},
      onSend: async () => {},
      onSubmitQuestionAnswers: async () => {},
      isSubmittingQuestionByRequestId: {},
      selectedModelSelection: null,
      isSelectionCatalogLoading: false,
      agentOptions: [{ value: "spec", label: "Spec" }],
      modelOptions: [],
      modelGroups: [],
      variantOptions: [],
      onSelectAgent: () => {},
      onSelectModel: () => {},
      onSelectVariant: () => {},
      activeSessionAgentColors: {},
      activeSessionContextUsage: null,
      isSubmittingPermissionByRequestId: {},
      permissionReplyErrorByRequestId: {},
      onReplyPermission: async () => {},
      input: "",
      setInput: () => {},
      stopAgentSession: async () => {},
    };

    const harness = createHookHarness({
      ...commonProps,
      sessionsForTask: [sessionA, sessionB],
      activeSession: sessionA,
    });

    await harness.mount();
    expect(harness.getLatest().agentChatModel.thread.todoPanelCollapsed).toBe(false);

    await harness.run((state) => {
      state.agentChatModel.thread.onToggleTodoPanel();
    });
    expect(harness.getLatest().agentChatModel.thread.todoPanelCollapsed).toBe(true);

    await harness.update({
      ...commonProps,
      sessionsForTask: [sessionA, sessionB],
      activeSession: sessionB,
    });
    expect(harness.getLatest().agentChatModel.thread.todoPanelCollapsed).toBe(false);

    await harness.run((state) => {
      state.agentChatModel.thread.onToggleTodoPanel();
    });
    expect(harness.getLatest().agentChatModel.thread.todoPanelCollapsed).toBe(true);

    await harness.update({
      ...commonProps,
      sessionsForTask: [sessionA, sessionB],
      activeSession: sessionA,
    });
    expect(harness.getLatest().agentChatModel.thread.todoPanelCollapsed).toBe(true);

    await harness.unmount();
  });
});
