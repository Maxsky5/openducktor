import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture, createTaskCardFixture } from "./agent-studio-test-utils";
import { buildAgentStudioPageModelsArgs } from "./use-agent-studio-orchestration-controller";

const taskDocument = {
  markdown: "# doc",
  updatedAt: "2026-02-22T10:00:00.000Z",
  isLoading: false,
  error: null,
  loaded: true,
};

describe("buildAgentStudioPageModelsArgs", () => {
  test("maps grouped orchestration context into page-model contracts", () => {
    const task = createTaskCardFixture({ id: "task-1", title: "Task 1" });
    const session = createAgentSessionFixture({
      sessionId: "session-1",
      taskId: "task-1",
      role: "planner",
      scenario: "planner_initial",
    });

    const onCreateTab = () => {};
    const onCloseTab = () => {};
    const onSelectAgent = () => {};
    const onSelectModel = () => {};
    const onSelectVariant = () => {};

    const mapped = buildAgentStudioPageModelsArgs({
      viewTaskId: "task-1",
      viewRole: "planner",
      viewSelectedTask: task,
      viewSessionsForTask: [session],
      viewActiveSession: session,
      activeTaskTabId: "task-1",
      taskTabs: [],
      availableTabTasks: [task],
      onCreateTab,
      onCloseTab,
      contextSwitchVersion: 4,
      isLoadingTasks: false,
      isActiveTaskHydrated: true,
      specDoc: taskDocument,
      planDoc: taskDocument,
      qaDoc: taskDocument,
      readiness: {
        agentStudioReady: true,
        agentStudioBlockedReason: "",
        isLoadingChecks: false,
        refreshChecks: async () => {},
      },
      sessionActions: {
        handleWorkflowStepSelect: () => {},
        handleSessionSelectionChange: () => {},
        handleCreateSession: () => {},
        isStarting: false,
        isSending: false,
        isSessionWorking: false,
        canKickoffNewSession: false,
        kickoffLabel: "Kickoff",
        canStopSession: false,
        startScenarioKickoff: async () => {},
        onSend: async () => {},
        onSubmitQuestionAnswers: async () => {},
        isSubmittingQuestionByRequestId: {},
        stopAgentSession: async () => {},
      },
      modelSelection: {
        selectedModelSelection: null,
        isSelectionCatalogLoading: false,
        agentOptions: [],
        modelOptions: [],
        modelGroups: [],
        variantOptions: [],
        onSelectAgent,
        onSelectModel,
        onSelectVariant,
        activeSessionAgentColors: {},
        activeSessionContextUsage: null,
      },
      permissions: {
        isSubmittingPermissionByRequestId: {},
        permissionReplyErrorByRequestId: {},
        onReplyPermission: async () => {},
      },
      composer: {
        input: "hello",
        setInput: () => {},
      },
    });

    expect(mapped.core.role).toBe("planner");
    expect(mapped.core.contextSwitchVersion).toBe(4);
    expect(mapped.taskTabs.onCreateTab).toBe(onCreateTab);
    expect(mapped.taskTabs.onCloseTab).toBe(onCloseTab);
    expect(mapped.documents.planDoc.markdown).toBe("# doc");
    expect(mapped.modelSelection.onSelectAgent).toBe(onSelectAgent);
    expect(mapped.modelSelection.onSelectModel).toBe(onSelectModel);
    expect(mapped.modelSelection.onSelectVariant).toBe(onSelectVariant);
    expect(mapped.composer.input).toBe("hello");
  });
});
