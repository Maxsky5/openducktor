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

type HookArgsOverrides = {
  core?: Partial<HookArgs["core"]>;
  taskTabs?: Partial<HookArgs["taskTabs"]>;
  documents?: Partial<HookArgs["documents"]>;
  readiness?: Partial<HookArgs["readiness"]>;
  sessionActions?: Partial<HookArgs["sessionActions"]>;
  modelSelection?: Partial<HookArgs["modelSelection"]>;
  permissions?: Partial<HookArgs["permissions"]>;
  chatSettings?: Partial<HookArgs["chatSettings"]>;
  composer?: Partial<HookArgs["composer"]>;
};

let useAgentStudioPageModels: UseAgentStudioPageModelsHook;

beforeAll(async () => {
  ({ useAgentStudioPageModels } = await import("./use-agent-studio-page-models"));
});

const createTask = () =>
  createTaskCardFixture({
    documentSummary: {
      spec: { has: true },
      plan: { has: false },
      qaReport: { has: false, verdict: "not_reviewed" },
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

const createHookArgs = (overrides: HookArgsOverrides = {}): HookArgs => {
  const defaultSession = createSession();
  const sessionsForTask = overrides.core?.sessionsForTask ?? [defaultSession];
  const activeSession =
    overrides.core?.activeSession !== undefined
      ? overrides.core.activeSession
      : (sessionsForTask[0] ?? null);
  const contextSessionsLength =
    overrides.core?.contextSessionsLength !== undefined
      ? overrides.core.contextSessionsLength
      : sessionsForTask.length;

  const core: HookArgs["core"] = {
    activeTabValue: "task-1",
    taskId: "task-1",
    role: "spec",
    selectedTask: createTask(),
    isTaskHydrating: false,
    isSessionHistoryHydrating: false,
    isSessionHistoryHydrationFailed: false,
    contextSwitchVersion: 0,
    ...overrides.core,
    sessionsForTask,
    activeSession,
    contextSessionsLength,
  };

  return {
    core,
    taskTabs: {
      taskTabs: [{ taskId: "task-1", taskTitle: "Task 1", status: "idle", isActive: true }],
      availableTabTasks: [createTask()],
      isLoadingTasks: false,
      onCreateTab: () => {},
      onCloseTab: () => {},
      ...overrides.taskTabs,
    },
    documents: {
      specDoc: createDocumentState("spec"),
      planDoc: createDocumentState(""),
      qaDoc: createDocumentState(""),
      ...overrides.documents,
    },
    readiness: {
      agentStudioReady: true,
      agentStudioBlockedReason: "",
      isLoadingChecks: false,
      refreshChecks: async () => {},
      ...overrides.readiness,
    },
    sessionActions: {
      handleWorkflowStepSelect: () => {},
      handleSessionSelectionChange: () => {},
      handleCreateSession: () => {},
      openTaskDetails: () => {},
      isStarting: false,
      isSending: false,
      isSessionWorking: true,
      isWaitingInput: false,
      canKickoffNewSession: false,
      kickoffLabel: "Start Spec",
      canStopSession: true,
      startScenarioKickoff: async () => {},
      onSend: async () => {},
      onSubmitQuestionAnswers: async () => {},
      isSubmittingQuestionByRequestId: {},
      stopAgentSession: async () => {},
      ...overrides.sessionActions,
    },
    modelSelection: {
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
      ...overrides.modelSelection,
    },
    permissions: {
      isSubmittingPermissionByRequestId: {},
      permissionReplyErrorByRequestId: {},
      onReplyPermission: async () => {},
      ...overrides.permissions,
    },
    chatSettings: {
      showThinkingMessages: false,
      ...overrides.chatSettings,
    },
    composer: {
      input: "",
      setInput: () => {},
      ...overrides.composer,
    },
  };
};

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioPageModels, initialProps);

describe("useAgentStudioPageModels", () => {
  test("builds page models and forwards wrapper callbacks", async () => {
    const onRefreshChecks = mock(async () => {});
    const onKickoff = mock(async () => {});
    const onSend = mock(async () => {});
    const onStopSession = mock(async () => {});

    const harness = createHookHarness(
      createHookArgs({
        modelSelection: {
          activeSessionContextUsage: { totalTokens: 12, contextWindow: 100 },
        },
        composer: {
          input: "message",
        },
        readiness: {
          refreshChecks: onRefreshChecks,
        },
        sessionActions: {
          onSend,
          startScenarioKickoff: onKickoff,
          stopAgentSession: onStopSession,
        },
      }),
    );

    await harness.mount();

    const state = harness.getLatest();
    expect(state.activeTabValue).toBe("task-1");
    expect(state.agentStudioTaskTabsModel.tabs).toHaveLength(1);
    expect(state.agentStudioHeaderModel.taskId).toBe("task-1");
    expect(state.agentChatModel.composer.contextUsage).toEqual({
      totalTokens: 12,
      contextWindow: 100,
    });
    expect(state.agentChatModel.thread.isSessionWorking).toBe(true);
    expect(state.agentChatModel.thread.showThinkingMessages).toBe(false);

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
        core: {
          role: "spec",
          activeSession: specSession,
          sessionsForTask: [specSession],
        },
        documents: {
          specDoc: createDocumentState("spec"),
          planDoc: createDocumentState(""),
          qaDoc: createDocumentState(""),
        },
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
        core: {
          role: "planner",
          activeSession: plannerSession,
          sessionsForTask: [plannerSession],
        },
        documents: {
          specDoc: createDocumentState(""),
          planDoc: createDocumentState("plan"),
          qaDoc: createDocumentState(""),
        },
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
        core: {
          role: "qa",
          activeSession: qaSession,
          sessionsForTask: [qaSession],
        },
        documents: {
          specDoc: createDocumentState(""),
          planDoc: createDocumentState(""),
          qaDoc: createDocumentState("qa"),
        },
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
        core: {
          role: "build",
          activeSession: buildSession,
          sessionsForTask: [buildSession],
        },
        documents: {
          specDoc: createDocumentState(""),
          planDoc: createDocumentState(""),
          qaDoc: createDocumentState(""),
        },
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
        core: {
          role: "spec",
          activeSession: plannerSession,
          sessionsForTask: [plannerSession],
        },
        documents: {
          specDoc: createDocumentState("spec"),
          planDoc: createDocumentState("plan"),
          qaDoc: createDocumentState(""),
        },
      }),
    );

    await harness.mount();
    expect(harness.getLatest().agentStudioWorkspaceSidebarModel.activeDocument?.title).toBe(
      "Implementation Plan",
    );
    await harness.unmount();
  });

  test("keeps build workspace document selection aligned to the resolved active session", async () => {
    const buildSession = createSession("session-build", "external-build", {
      role: "build",
      scenario: "build_implementation_start",
    });
    const harness = createHookHarness(
      createHookArgs({
        core: {
          role: "qa",
          activeSession: buildSession,
          sessionsForTask: [buildSession],
        },
        documents: {
          specDoc: createDocumentState("spec"),
          planDoc: createDocumentState("plan"),
          qaDoc: createDocumentState("qa"),
        },
      }),
    );

    await harness.mount();
    expect(harness.getLatest().agentStudioWorkspaceSidebarModel.activeDocument).toBeNull();
    await harness.unmount();
  });

  test("includes pending permission count in header stats", async () => {
    const permissionSession = createSession("session-1", "external-1", {
      status: "running",
      pendingPermissions: [{ requestId: "p-1", permission: "shell", patterns: ["rm -rf /tmp"] }],
    });
    const harness = createHookHarness(
      createHookArgs({
        core: {
          activeSession: permissionSession,
          sessionsForTask: [permissionSession],
        },
      }),
    );

    await harness.mount();
    expect(harness.getLatest().agentStudioHeaderModel.stats.permissions).toBe(1);

    const permissionSessionWithoutRequests = createSession("session-1", "external-1", {
      status: "running",
      pendingPermissions: [],
    });

    await harness.update(
      createHookArgs({
        core: {
          activeSession: permissionSessionWithoutRequests,
          sessionsForTask: [permissionSessionWithoutRequests],
        },
      }),
    );

    expect(harness.getLatest().agentStudioHeaderModel.stats.permissions).toBe(0);
    await harness.unmount();
  });

  test("tracks todo panel collapse state per active session", async () => {
    const sessionA = createSession("session-a", "external-a");
    const sessionB = createSession("session-b", "external-b");
    const sharedOverrides: HookArgsOverrides = {
      core: {
        contextSessionsLength: 2,
      },
      sessionActions: {
        isSessionWorking: false,
      },
      modelSelection: {
        activeSessionContextUsage: null,
      },
    };

    const harness = createHookHarness(
      createHookArgs({
        ...sharedOverrides,
        core: {
          ...sharedOverrides.core,
          sessionsForTask: [sessionA, sessionB],
          activeSession: sessionA,
        },
      }),
    );

    await harness.mount();
    expect(harness.getLatest().agentChatModel.thread.todoPanelCollapsed).toBe(true);

    await harness.run((state) => {
      state.agentChatModel.thread.onToggleTodoPanel();
    });
    expect(harness.getLatest().agentChatModel.thread.todoPanelCollapsed).toBe(false);

    await harness.update(
      createHookArgs({
        ...sharedOverrides,
        core: {
          ...sharedOverrides.core,
          sessionsForTask: [sessionA, sessionB],
          activeSession: sessionB,
        },
      }),
    );
    expect(harness.getLatest().agentChatModel.thread.todoPanelCollapsed).toBe(true);

    await harness.run((state) => {
      state.agentChatModel.thread.onToggleTodoPanel();
    });
    expect(harness.getLatest().agentChatModel.thread.todoPanelCollapsed).toBe(false);

    await harness.update(
      createHookArgs({
        ...sharedOverrides,
        core: {
          ...sharedOverrides.core,
          sessionsForTask: [sessionA, sessionB],
          activeSession: sessionA,
        },
      }),
    );
    expect(harness.getLatest().agentChatModel.thread.todoPanelCollapsed).toBe(false);

    await harness.unmount();
  });

  test("keeps thread model stable for input-only composer updates", async () => {
    const session = createSession("session-1", "external-1");
    const baseProps = createHookArgs({
      core: {
        activeSession: session,
        sessionsForTask: [session],
      },
      composer: {
        input: "",
      },
    });
    const harness = createHookHarness(baseProps);

    await harness.mount();
    const initialState = harness.getLatest();
    const initialThreadModel = initialState.agentChatModel.thread;
    const initialComposerModel = initialState.agentChatModel.composer;

    await harness.update({
      ...baseProps,
      composer: {
        ...baseProps.composer,
        input: "draft update",
      },
    });

    const nextState = harness.getLatest();
    expect(nextState.agentChatModel.thread).toBe(initialThreadModel);
    expect(nextState.agentChatModel.composer).not.toBe(initialComposerModel);
    expect(nextState.agentChatModel.composer.input).toBe("draft update");

    await harness.unmount();
  });

  test("keeps composer model stable for thread-only updates", async () => {
    const session = createSession("session-1", "external-1");
    const baseProps = createHookArgs({
      core: {
        activeSession: session,
        sessionsForTask: [session],
      },
      composer: {
        input: "draft",
      },
    });
    const harness = createHookHarness(baseProps);

    await harness.mount();
    const initialState = harness.getLatest();
    const initialThreadModel = initialState.agentChatModel.thread;
    const initialComposerModel = initialState.agentChatModel.composer;

    await harness.run((state) => {
      state.agentChatModel.thread.onToggleTodoPanel();
    });

    const nextState = harness.getLatest();
    expect(nextState.agentChatModel.thread).not.toBe(initialThreadModel);
    expect(nextState.agentChatModel.composer).toBe(initialComposerModel);
    expect(nextState.agentChatModel.thread.todoPanelCollapsed).toBe(false);

    await harness.unmount();
  });

  test("updates thread model when showThinkingMessages changes without rebuilding composer", async () => {
    const session = createSession("session-1", "external-1");
    const baseProps = createHookArgs({
      core: {
        activeSession: session,
        sessionsForTask: [session],
      },
      composer: {
        input: "draft",
      },
      chatSettings: {
        showThinkingMessages: false,
      },
    });
    const harness = createHookHarness(baseProps);

    await harness.mount();
    const initialState = harness.getLatest();
    const initialThreadModel = initialState.agentChatModel.thread;
    const initialComposerModel = initialState.agentChatModel.composer;

    await harness.update({
      ...baseProps,
      chatSettings: {
        showThinkingMessages: true,
      },
    });

    const nextState = harness.getLatest();
    expect(nextState.agentChatModel.thread).not.toBe(initialThreadModel);
    expect(nextState.agentChatModel.composer).toBe(initialComposerModel);
    expect(nextState.agentChatModel.thread.showThinkingMessages).toBe(true);

    await harness.unmount();
  });

  test("updates thread model for pending request maps without rebuilding composer", async () => {
    const session = createSession("session-1", "external-1");
    const baseProps = createHookArgs({
      core: {
        activeSession: session,
        sessionsForTask: [session],
      },
      composer: {
        input: "draft",
      },
    });
    const harness = createHookHarness(baseProps);

    await harness.mount();
    const initialState = harness.getLatest();
    const initialThreadModel = initialState.agentChatModel.thread;
    const initialComposerModel = initialState.agentChatModel.composer;

    const permissionUpdateProps = {
      ...baseProps,
      permissions: {
        ...baseProps.permissions,
        isSubmittingPermissionByRequestId: {
          "perm-1": true,
        },
      },
    };
    await harness.update(permissionUpdateProps);

    const permissionState = harness.getLatest();
    const permissionThreadModel = permissionState.agentChatModel.thread;
    expect(permissionThreadModel).not.toBe(initialThreadModel);
    expect(permissionState.agentChatModel.composer).toBe(initialComposerModel);
    expect(permissionThreadModel.isSubmittingPermissionByRequestId["perm-1"]).toBe(true);

    await harness.update({
      ...permissionUpdateProps,
      sessionActions: {
        ...permissionUpdateProps.sessionActions,
        isSubmittingQuestionByRequestId: {
          "q-1": true,
        },
      },
    });

    const questionState = harness.getLatest();
    expect(questionState.agentChatModel.thread).not.toBe(permissionThreadModel);
    expect(questionState.agentChatModel.composer).toBe(initialComposerModel);
    expect(questionState.agentChatModel.thread.isSubmittingQuestionByRequestId["q-1"]).toBe(true);

    await harness.unmount();
  });

  test("keeps composer model stable when active session reference changes with same session id", async () => {
    const initialSession = createSession("session-1", "external-1", {
      role: "spec",
      status: "running",
      isLoadingModelCatalog: false,
    });
    const baseProps = createHookArgs({
      core: {
        activeSession: initialSession,
        sessionsForTask: [initialSession],
      },
      composer: {
        input: "draft",
      },
      sessionActions: {
        isSessionWorking: true,
      },
    });
    const harness = createHookHarness(baseProps);

    await harness.mount();
    const initialComposerModel = harness.getLatest().agentChatModel.composer;

    const sameSessionIdNewRef = createSession("session-1", "external-1", {
      role: "spec",
      status: "running",
      isLoadingModelCatalog: false,
    });
    await harness.update(
      createHookArgs({
        ...baseProps,
        core: {
          ...baseProps.core,
          activeSession: sameSessionIdNewRef,
          sessionsForTask: [sameSessionIdNewRef],
        },
      }),
    );

    const nextComposerModel = harness.getLatest().agentChatModel.composer;
    expect(nextComposerModel).toBe(initialComposerModel);

    await harness.unmount();
  });

  test("updates composer model when a running session starts waiting for input", async () => {
    const initialSession = createSession("session-1", "external-1", {
      role: "spec",
      status: "running",
      pendingQuestions: [],
      isLoadingModelCatalog: false,
    });
    const baseProps = createHookArgs({
      core: {
        activeSession: initialSession,
        sessionsForTask: [initialSession],
      },
      composer: {
        input: "draft",
      },
      sessionActions: {
        isSessionWorking: true,
        isWaitingInput: false,
      },
    });
    const harness = createHookHarness(baseProps);

    await harness.mount();
    const initialComposerModel = harness.getLatest().agentChatModel.composer;
    expect(initialComposerModel.isWaitingInput).toBe(false);

    const waitingSession = createSession("session-1", "external-1", {
      role: "spec",
      status: "running",
      pendingQuestions: [
        {
          requestId: "question-1",
          questions: [
            {
              header: "Question",
              question: "Need input",
              options: [{ label: "Reply", description: "Provide input" }],
            },
          ],
        },
      ],
      isLoadingModelCatalog: false,
    });
    await harness.update(
      createHookArgs({
        ...baseProps,
        core: {
          ...baseProps.core,
          activeSession: waitingSession,
          sessionsForTask: [waitingSession],
        },
        sessionActions: {
          ...baseProps.sessionActions,
          isSessionWorking: true,
          isWaitingInput: true,
        },
      }),
    );

    const nextComposerModel = harness.getLatest().agentChatModel.composer;
    expect(nextComposerModel).not.toBe(initialComposerModel);
    expect(nextComposerModel.isWaitingInput).toBe(true);
    expect(nextComposerModel.waitingInputPlaceholder).toBe(
      "Answer the pending question above to continue",
    );

    await harness.unmount();
  });

  test("treats unavailable selected role as read-only and hides kickoff action", async () => {
    const unavailablePlannerTask = createTaskCardFixture({
      status: "open",
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: false, completed: false },
        builder: { required: true, canSkip: false, available: false, completed: false },
        qa: { required: true, canSkip: false, available: false, completed: false },
      },
    });

    const harness = createHookHarness(
      createHookArgs({
        core: {
          role: "planner",
          selectedTask: unavailablePlannerTask,
          activeSession: null,
          sessionsForTask: [],
        },
        sessionActions: {
          canKickoffNewSession: true,
          isSessionWorking: false,
        },
      }),
    );

    await harness.mount();

    const state = harness.getLatest();
    expect(state.agentChatModel.thread.canKickoffNewSession).toBe(false);
    expect(state.agentChatModel.composer.isReadOnly).toBe(true);
    expect(state.agentChatModel.composer.readOnlyReason).toContain("Planner is unavailable");

    await harness.unmount();
  });

  test("keeps stop control enabled for running session even when role is unavailable", async () => {
    const unavailablePlannerTask = createTaskCardFixture({
      status: "open",
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: false, completed: false },
        builder: { required: true, canSkip: false, available: false, completed: false },
        qa: { required: true, canSkip: false, available: false, completed: false },
      },
    });
    const runningPlannerSession = createSession("session-plan", "external-plan", {
      role: "planner",
      scenario: "planner_initial",
      status: "running",
    });

    const harness = createHookHarness(
      createHookArgs({
        core: {
          role: "planner",
          selectedTask: unavailablePlannerTask,
          activeSession: runningPlannerSession,
          sessionsForTask: [runningPlannerSession],
        },
        sessionActions: {
          canStopSession: true,
          isSessionWorking: true,
        },
      }),
    );

    await harness.mount();

    const state = harness.getLatest();
    expect(state.agentChatModel.composer.isReadOnly).toBe(true);
    expect(state.agentChatModel.composer.canStopSession).toBe(true);

    await harness.unmount();
  });
});
