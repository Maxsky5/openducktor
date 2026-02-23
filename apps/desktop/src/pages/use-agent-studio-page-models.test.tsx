import { beforeAll, describe, expect, mock, test } from "bun:test";
import type { TaskDocumentState } from "@/components/features/task-details/use-task-documents";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  createAgentSessionFixture,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";

type UseAgentStudioPageModelsHook =
  typeof import("./use-agent-studio-page-models")["useAgentStudioPageModels"];

enableReactActEnvironment();

type HookArgs = Parameters<UseAgentStudioPageModelsHook>[0];

let useAgentStudioPageModels: UseAgentStudioPageModelsHook;

beforeAll(async () => {
  ({ useAgentStudioPageModels } = await import("./use-agent-studio-page-models"));
});

const createTask = () =>
  createTaskCardFixture({
    documentSummary: {
      spec: { has: true },
      plan: { has: false },
      qaReport: { has: false },
    },
  });

const createSession = (
  sessionId = "session-1",
  externalSessionId = "external-1",
  overrides: Partial<AgentSessionState> = {},
): AgentSessionState =>
  createAgentSessionFixture({
    sessionId,
    externalSessionId,
    status: "running",
    ...overrides,
  });

const createDocumentState = (markdown: string): TaskDocumentState => ({
  markdown,
  updatedAt: null,
  isLoading: false,
  error: null,
  loaded: true,
});

const createHookArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
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
  refreshChecks: async () => {},
  isStarting: false,
  isSending: false,
  isSessionWorking: true,
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
  activeSessionContextUsage: { totalTokens: 12, contextWindow: 100 },
  isSubmittingPermissionByRequestId: {},
  permissionReplyErrorByRequestId: {},
  onReplyPermission: async () => {},
  input: "",
  setInput: () => {},
  stopAgentSession: async () => {},
  ...overrides,
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
      ...createHookArgs({
        activeSessionContextUsage: { totalTokens: 12, contextWindow: 100 },
        input: "message",
        onReplyPermission: async () => {},
        onSend,
        refreshChecks: onRefreshChecks,
        startScenarioKickoff: onKickoff,
        stopAgentSession: onStopSession,
      }),
      refreshChecks: onRefreshChecks,
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

  test("selects role-specific sidebar document", async () => {
    const specSession = createSession("session-spec", "external-spec", { role: "spec" });
    const harness = createHookHarness(
      createHookArgs({
        role: "spec",
        activeSession: specSession,
        sessionsForTask: [specSession],
        specDoc: createDocumentState("spec"),
        planDoc: createDocumentState(""),
        qaDoc: createDocumentState(""),
      }),
    );
    await harness.mount();
    expect(harness.getLatest().agentStudioWorkspaceSidebarModel.activeDocument?.title).toBe(
      "Specification",
    );
    await harness.unmount();

    const plannerSession = createSession("session-planner", "external-planner", {
      role: "planner",
    });
    const plannerHarness = createHookHarness(
      createHookArgs({
        role: "planner",
        activeSession: plannerSession,
        sessionsForTask: [plannerSession],
        specDoc: createDocumentState(""),
        planDoc: createDocumentState("plan"),
        qaDoc: createDocumentState(""),
      }),
    );
    await plannerHarness.mount();
    expect(plannerHarness.getLatest().agentStudioWorkspaceSidebarModel.activeDocument?.title).toBe(
      "Implementation Plan",
    );
    await plannerHarness.unmount();

    const qaSession = createSession("session-qa", "external-qa", {
      role: "qa",
      scenario: "qa_review",
    });
    const qaHarness = createHookHarness(
      createHookArgs({
        role: "qa",
        activeSession: qaSession,
        sessionsForTask: [qaSession],
        specDoc: createDocumentState(""),
        planDoc: createDocumentState(""),
        qaDoc: createDocumentState("qa"),
      }),
    );
    await qaHarness.mount();
    expect(qaHarness.getLatest().agentStudioWorkspaceSidebarModel.activeDocument?.title).toBe(
      "QA Report",
    );
    await qaHarness.unmount();

    const buildSession = createSession("session-build", "external-build", { role: "build" });
    const buildHarness = createHookHarness(
      createHookArgs({
        role: "build",
        activeSession: buildSession,
        sessionsForTask: [buildSession],
        specDoc: createDocumentState(""),
        planDoc: createDocumentState(""),
        qaDoc: createDocumentState(""),
      }),
    );
    await buildHarness.mount();
    expect(buildHarness.getLatest().agentStudioWorkspaceSidebarModel.activeDocument).toBeNull();
    await buildHarness.unmount();
  });

  test("uses active session role to select workspace document when URL role is stale", async () => {
    const plannerSession = createSession("session-1", "external-1", {
      role: "planner",
      scenario: "planner_initial",
    });
    const harness = createHookHarness(
      createHookArgs({
        role: "spec",
        activeSession: plannerSession,
        sessionsForTask: [plannerSession],
        specDoc: createDocumentState("spec"),
        planDoc: createDocumentState("plan"),
        qaDoc: createDocumentState(""),
      }),
    );

    await harness.mount();
    expect(harness.getLatest().agentStudioWorkspaceSidebarModel.activeDocument?.title).toBe(
      "Implementation Plan",
    );
    await harness.unmount();
  });

  test("includes pending permission count in header stats", async () => {
    const permissionSession = createSession("session-1", "external-1", {
      status: "running",
      pendingPermissions: [{ requestId: "p-1", permission: "shell", patterns: ["rm -rf /tmp"] }],
    });
    const harness = createHookHarness(
      createHookArgs({
        activeSession: permissionSession,
        sessionsForTask: [permissionSession],
      }),
    );

    await harness.mount();
    expect(harness.getLatest().agentStudioHeaderModel.stats.permissions).toBe(1);

    const permissionSessionWithoutRequests = createSession("session-1", "external-1", {
      status: "running",
      pendingPermissions: [],
    });

    await harness.update({
      ...createHookArgs({
        activeSession: permissionSessionWithoutRequests,
        sessionsForTask: [permissionSessionWithoutRequests],
      }),
    });

    expect(harness.getLatest().agentStudioHeaderModel.stats.permissions).toBe(0);
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
