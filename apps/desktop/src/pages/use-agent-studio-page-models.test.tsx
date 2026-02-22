import { describe, expect, mock, test } from "bun:test";
import type { TaskDocumentState } from "@/components/features/task-details/use-task-documents";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { TaskCard } from "@openducktor/contracts";
import { type ReactElement, createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { useAgentStudioPageModels } from "./use-agent-studio-page-models";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

type HookArgs = Parameters<typeof useAgentStudioPageModels>[0];
type HookState = ReturnType<typeof useAgentStudioPageModels>;

const createTask = (): TaskCard => ({
  id: "task-1",
  title: "Task 1",
  description: "",
  acceptanceCriteria: "",
  notes: "",
  status: "open",
  priority: 2,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  parentId: undefined,
  subtaskIds: [],
  assignee: undefined,
  documentSummary: {
    spec: { has: true },
    plan: { has: false },
    qaReport: { has: false },
  },
  updatedAt: "2026-02-22T12:00:00.000Z",
  createdAt: "2026-02-22T12:00:00.000Z",
});

const createSession = (): AgentSessionState => ({
  sessionId: "session-1",
  externalSessionId: "external-1",
  taskId: "task-1",
  role: "spec",
  scenario: "spec_initial",
  status: "running",
  startedAt: "2026-02-22T10:00:00.000Z",
  runtimeId: null,
  runId: null,
  baseUrl: "http://localhost:4000",
  workingDirectory: "/repo",
  messages: [],
  draftAssistantText: "",
  pendingPermissions: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
});

const createDocumentState = (markdown: string): TaskDocumentState => ({
  markdown,
  updatedAt: null,
  isLoading: false,
  error: null,
  loaded: true,
});

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const createHookHarness = (initialProps: HookArgs) => {
  let latest: HookState | null = null;

  const Harness = (props: HookArgs): ReactElement | null => {
    latest = useAgentStudioPageModels(props);
    return null;
  };

  let renderer: TestRenderer.ReactTestRenderer | null = null;

  const mount = async (): Promise<void> => {
    await act(async () => {
      renderer = TestRenderer.create(createElement(Harness, initialProps));
      await flush();
    });
  };

  const getLatest = (): HookState => {
    if (!latest) {
      throw new Error("Hook state unavailable");
    }
    return latest;
  };

  const unmount = async (): Promise<void> => {
    await act(async () => {
      renderer?.unmount();
      await flush();
    });
  };

  return { mount, getLatest, unmount };
};

describe("useAgentStudioPageModels", () => {
  test("builds page models and forwards wrapper callbacks", async () => {
    const onRefreshChecks = mock(async () => {});
    const onKickoff = mock(async () => {});
    const onSend = mock(async () => {});
    const onStopSession = mock(async () => {});

    const harness = createHookHarness({
      taskId: "task-1",
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
});
