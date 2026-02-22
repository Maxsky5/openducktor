import { describe, expect, mock, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { Sparkles } from "lucide-react";
import type { TaskDocumentState } from "@/components/features/task-details/use-task-documents";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  buildAgentChatModel,
  buildAgentStudioHeaderModel,
  buildAgentStudioTaskTabsModel,
  buildAgentStudioWorkspaceSidebarModel,
  buildRoleLabelByRole,
} from "./agents-page-view-model";

const createTaskCard = (id: string): TaskCard => ({
  id,
  title: `Task ${id}`,
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
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false },
  },
  updatedAt: "2026-02-22T12:00:00.000Z",
  createdAt: "2026-02-22T12:00:00.000Z",
});

const createSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  sessionId: "session-1",
  externalSessionId: "external-1",
  taskId: "task-1",
  role: "spec",
  scenario: "spec_initial",
  status: "running",
  startedAt: "2026-02-22T12:00:00.000Z",
  runtimeId: null,
  runId: null,
  baseUrl: "http://localhost:1234",
  workingDirectory: "/repo",
  messages: [],
  draftAssistantText: "",
  pendingPermissions: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
  ...overrides,
});

const createDocumentState = (markdown = ""): TaskDocumentState => ({
  markdown,
  updatedAt: null,
  isLoading: false,
  error: null,
  loaded: true,
});

describe("agents-page-view-model", () => {
  test("buildRoleLabelByRole preserves defaults and applies provided labels", () => {
    const labels = buildRoleLabelByRole([
      { role: "spec", label: "Specification", icon: Sparkles },
      { role: "build", label: "Builder", icon: Sparkles },
    ]);

    expect(labels.spec).toBe("Specification");
    expect(labels.build).toBe("Builder");
    expect(labels.planner).toBe("Planner");
    expect(labels.qa).toBe("QA");
  });

  test("buildAgentStudioTaskTabsModel maps tab model fields", () => {
    const onCreateTab = mock(() => {});
    const onCloseTab = mock(() => {});
    const task = createTaskCard("task-1");

    const model = buildAgentStudioTaskTabsModel({
      taskTabs: [{ taskId: task.id, taskTitle: task.title, status: "idle", isActive: true }],
      availableTabTasks: [task],
      isLoadingTasks: true,
      onCreateTab,
      onCloseTab,
      agentStudioReady: false,
    });

    expect(model.tabs).toHaveLength(1);
    expect(model.availableTabTasks[0]?.id).toBe("task-1");
    expect(model.isLoadingAvailableTabTasks).toBe(true);
    expect(model.agentStudioReady).toBe(false);
  });

  test("buildAgentStudioHeaderModel keeps selector and workflow contracts", () => {
    const onWorkflowStepSelect = mock(() => {});
    const onSessionSelectionChange = mock(() => {});
    const onCreateSession = mock(() => {});
    const activeSession = createSession({
      pendingPermissions: [{ requestId: "req-1", permission: "read", patterns: ["**/*"] }],
      pendingQuestions: [{ requestId: "q-1", questions: [] }],
      messages: [{ id: "m-1", role: "assistant", content: "ok", timestamp: "now" }],
    });

    const model = buildAgentStudioHeaderModel({
      selectedTask: createTaskCard("task-1"),
      activeSession,
      roleOptions: [
        { role: "spec", label: "Spec", icon: Sparkles },
        { role: "planner", label: "Planner", icon: Sparkles },
      ],
      workflowStateByRole: {
        spec: "in_progress",
        planner: "available",
        build: "blocked",
        qa: "blocked",
      },
      selectedRole: "spec",
      latestSessionByRole: {
        spec: activeSession,
        planner: null,
        build: null,
        qa: null,
      },
      onWorkflowStepSelect,
      onSessionSelectionChange,
      sessionSelectorValue: activeSession.sessionId,
      sessionSelectorGroups: [
        { label: "Recent", options: [{ value: activeSession.sessionId, label: "Spec session" }] },
      ],
      agentStudioReady: false,
      sessionsForTaskLength: 0,
      sessionCreateOptions: [],
      onCreateSession,
      createSessionDisabled: true,
      isStarting: true,
      contextSessionsLength: 2,
    });

    expect(model.workflowSteps).toHaveLength(2);
    expect(model.sessionSelector.disabled).toBe(true);
    expect(model.stats).toEqual({ sessions: 2, messages: 1, permissions: 1, questions: 1 });

    model.sessionSelector.onValueChange("session-next");
    expect(onSessionSelectionChange).toHaveBeenCalledWith("session-next");
  });

  test("buildAgentStudioWorkspaceSidebarModel forwards permission and docs state", () => {
    const onReplyPermission = mock(() => {});

    const model = buildAgentStudioWorkspaceSidebarModel({
      agentStudioReady: true,
      pendingPermissions: [{ requestId: "req-1", permission: "write", patterns: ["src/**"] }],
      isSubmittingPermissionByRequestId: { "req-1": true },
      permissionReplyErrorByRequestId: { "req-1": "denied" },
      onReplyPermission,
      specDoc: createDocumentState("spec"),
      planDoc: createDocumentState("plan"),
      qaDoc: createDocumentState("qa"),
    });

    expect(model.pendingPermissions).toHaveLength(1);
    expect(model.specDoc.markdown).toBe("spec");
    model.onReplyPermission("req-1", "once");
    expect(onReplyPermission).toHaveBeenCalledWith("req-1", "once");
  });

  test("buildAgentChatModel composes thread and composer behavior", async () => {
    const onRefreshChecks = mock(() => {});
    const onKickoff = mock(() => {});
    const onSubmitQuestionAnswers = mock(async () => {});
    const onToggleTodoPanel = mock(() => {});
    const onSend = mock(() => {});
    const onStopSession = mock(() => {});

    const model = buildAgentChatModel({
      activeSession: createSession(),
      roleOptions: [{ role: "spec", label: "Spec", icon: Sparkles }],
      agentStudioReady: true,
      agentStudioBlockedReason: "",
      isLoadingChecks: false,
      onRefreshChecks,
      taskId: "",
      canKickoffNewSession: true,
      kickoffLabel: "Start Spec",
      onKickoff,
      isStarting: false,
      isSending: false,
      activeSessionAgentColors: {},
      isSubmittingQuestionByRequestId: {},
      onSubmitQuestionAnswers,
      todoPanelCollapsed: false,
      onToggleTodoPanel,
      todoPanelBottomOffset: 12,
      messagesContainerRef: { current: null },
      onMessagesScroll: () => {},
      input: "message",
      onInputChange: () => {},
      onSend,
      isSessionWorking: true,
      selectedModelSelection: null,
      isSelectionCatalogLoading: false,
      agentOptions: [],
      modelOptions: [],
      modelGroups: [],
      variantOptions: [],
      onSelectAgent: () => {},
      onSelectModel: () => {},
      onSelectVariant: () => {},
      contextUsage: { totalTokens: 10, contextWindow: 100 },
      canStopSession: true,
      onStopSession,
      composerFormRef: { current: null },
      composerTextareaRef: { current: null },
      onComposerTextareaInput: () => {},
    });

    expect(model.thread.taskSelected).toBe(false);
    expect(model.composer.contextUsage).toEqual({ totalTokens: 10, contextWindow: 100 });

    model.thread.onRefreshChecks();
    model.thread.onKickoff();
    await model.thread.onSubmitQuestionAnswers("req-1", [["yes"]]);
    model.thread.onToggleTodoPanel();
    model.composer.onSend();
    model.composer.onStopSession();

    expect(onRefreshChecks).toHaveBeenCalledTimes(1);
    expect(onKickoff).toHaveBeenCalledTimes(1);
    expect(onSubmitQuestionAnswers).toHaveBeenCalledWith("req-1", [["yes"]]);
    expect(onToggleTodoPanel).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onStopSession).toHaveBeenCalledTimes(1);
  });
});
