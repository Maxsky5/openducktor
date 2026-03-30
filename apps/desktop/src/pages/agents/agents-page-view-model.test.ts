import { describe, expect, mock, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { Sparkles } from "lucide-react";
import { createComposerDraft } from "@/components/features/agents/agent-chat/agent-chat-test-fixtures";
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
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: true, completed: false },
    planner: { required: false, canSkip: true, available: true, completed: false },
    builder: { required: true, canSkip: false, available: true, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  updatedAt: "2026-02-22T12:00:00.000Z",
  createdAt: "2026-02-22T12:00:00.000Z",
});

const createSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  runtimeKind: "opencode",
  sessionId: "session-1",
  externalSessionId: "external-1",
  taskId: "task-1",
  role: "spec",
  scenario: "spec_initial",
  status: "running",
  startedAt: "2026-02-22T12:00:00.000Z",
  runtimeId: null,
  runId: null,
  runtimeEndpoint: "http://localhost:1234",
  workingDirectory: "/repo",
  messages: [],
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
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
      onOpenTaskDetails: mock(() => {}),
      activeSession,
      roleOptions: [
        { role: "spec", label: "Spec", icon: Sparkles },
        { role: "planner", label: "Planner", icon: Sparkles },
      ],
      workflowStateByRole: {
        spec: {
          tone: "in_progress",
          availability: "available",
          completion: "in_progress",
          liveSession: "waiting_input",
        },
        planner: {
          tone: "available",
          availability: "available",
          completion: "not_started",
          liveSession: "none",
        },
        build: {
          tone: "blocked",
          availability: "blocked",
          completion: "not_started",
          liveSession: "none",
        },
        qa: {
          tone: "blocked",
          availability: "blocked",
          completion: "not_started",
          liveSession: "none",
        },
      },
      selectedRole: "spec",
      workflowSessionByRole: {
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
    expect(typeof model.onOpenTaskDetails).toBe("function");
    expect(model.sessionSelector.disabled).toBe(true);
    expect(model.stats).toEqual({ sessions: 2, messages: 1, permissions: 1, questions: 1 });

    model.sessionSelector.onValueChange("session-next");
    expect(onSessionSelectionChange).toHaveBeenCalledWith("session-next");
  });

  test("buildAgentStudioHeaderModel clears task details action when no task is selected", () => {
    const model = buildAgentStudioHeaderModel({
      selectedTask: null,
      onOpenTaskDetails: mock(() => {}),
      activeSession: null,
      roleOptions: [],
      workflowStateByRole: {
        spec: {
          tone: "blocked",
          availability: "blocked",
          completion: "not_started",
          liveSession: "none",
        },
        planner: {
          tone: "blocked",
          availability: "blocked",
          completion: "not_started",
          liveSession: "none",
        },
        build: {
          tone: "blocked",
          availability: "blocked",
          completion: "not_started",
          liveSession: "none",
        },
        qa: {
          tone: "blocked",
          availability: "blocked",
          completion: "not_started",
          liveSession: "none",
        },
      },
      selectedRole: null,
      workflowSessionByRole: {
        spec: null,
        planner: null,
        build: null,
        qa: null,
      },
      onWorkflowStepSelect: mock(() => {}),
      onSessionSelectionChange: mock(() => {}),
      sessionSelectorValue: "",
      sessionSelectorGroups: [],
      agentStudioReady: true,
      sessionsForTaskLength: 0,
      sessionCreateOptions: [],
      onCreateSession: mock(() => {}),
      createSessionDisabled: false,
      isStarting: false,
      contextSessionsLength: 0,
    });

    expect(model.onOpenTaskDetails).toBeNull();
  });

  test("buildAgentStudioWorkspaceSidebarModel forwards active document state", () => {
    const onReplyPermission = mock(() => {});

    const model = buildAgentStudioWorkspaceSidebarModel({
      activeDocument: {
        title: "Specification",
        description: "Current specification document for this task.",
        emptyState: "No spec document yet.",
        document: createDocumentState("spec"),
      },
    });

    expect(model.activeDocument).toEqual({
      title: "Specification",
      description: "Current specification document for this task.",
      emptyState: "No spec document yet.",
      document: createDocumentState("spec"),
    });

    expect(onReplyPermission).not.toHaveBeenCalled();
  });

  test("buildAgentChatModel composes thread and composer behavior", async () => {
    const onRefreshChecks = mock(() => {});
    const onKickoff = mock(() => {});
    const onSubmitQuestionAnswers = mock(async () => {});
    const onReplyPermission = mock(async () => {});
    const onToggleTodoPanel = mock(() => {});
    const onSend = mock((_draft?: unknown) => true);
    const onStopSession = mock(() => {});

    const model = buildAgentChatModel({
      activeSession: createSession(),
      isSessionWorking: true,
      showThinkingMessages: true,
      isSessionViewLoading: false,
      isSessionHistoryLoading: false,
      roleOptions: [{ role: "spec", label: "Spec", icon: Sparkles }],
      agentStudioReadinessState: "ready",
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
      isSubmittingPermissionByRequestId: {},
      permissionReplyErrorByRequestId: {},
      onReplyPermission,
      onSubmitQuestionAnswers,
      todoPanelCollapsed: false,
      onToggleTodoPanel,
      messagesContainerRef: { current: null },
      scrollToBottomOnSendRef: { current: null } as { current: (() => void) | null },
      syncBottomAfterComposerLayoutRef: { current: null } as { current: (() => void) | null },
      draftStateKey: "draft-1",
      isReadOnly: false,
      readOnlyReason: null,
      busySendBlockedReason: null,
      onSend: async (draft) => onSend(draft),
      isWaitingInput: false,
      isModelSelectionPending: false,
      selectedModelSelection: null,
      isSelectionCatalogLoading: false,
      supportsSlashCommands: true,
      slashCommandCatalog: { commands: [] },
      slashCommands: [],
      slashCommandsError: null,
      isSlashCommandsLoading: false,
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
      composerEditorRef: { current: null },
      onComposerEditorInput: () => {},
    });

    expect(model.thread.taskSelected).toBe(false);
    expect(model.thread.isSessionWorking).toBe(true);
    expect(model.thread.showThinkingMessages).toBe(true);
    expect(model.thread.readinessState).toBe("ready");
    expect(model.composer.contextUsage).toEqual({ totalTokens: 10, contextWindow: 100 });

    model.thread.onRefreshChecks();
    model.thread.onKickoff();
    await model.thread.onSubmitQuestionAnswers("req-1", [["yes"]]);
    await model.thread.onReplyPermission("req-1", "reject");
    model.thread.onToggleTodoPanel();
    await model.composer.onSend(createComposerDraft("message"));
    model.composer.onStopSession();

    expect(onRefreshChecks).toHaveBeenCalledTimes(1);
    expect(onKickoff).toHaveBeenCalledTimes(1);
    expect(onSubmitQuestionAnswers).toHaveBeenCalledWith("req-1", [["yes"]]);
    expect(onReplyPermission).toHaveBeenCalledWith("req-1", "reject");
    expect(onToggleTodoPanel).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onStopSession).toHaveBeenCalledTimes(1);
  });
});
