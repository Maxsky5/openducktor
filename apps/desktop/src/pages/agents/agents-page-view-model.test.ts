import { describe, expect, mock, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { Sparkles } from "lucide-react";
import type { TaskDocumentState } from "@/components/features/task-details/use-task-documents";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
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
  repoPath: overrides.repoPath ?? "/repo",
  role: "spec",
  scenario: "spec_initial",
  status: "running",
  startedAt: "2026-02-22T12:00:00.000Z",
  runtimeId: null,
  runtimeRoute: { type: "local_http", endpoint: "http://localhost:1234" },
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
    const onSelectTab = mock(() => {});
    const onCreateTab = mock(() => {});
    const onCloseTab = mock(() => {});
    const onReorderTab = mock(() => {});
    const task = createTaskCard("task-1");

    const model = buildAgentStudioTaskTabsModel({
      taskTabs: [{ taskId: task.id, taskTitle: task.title, status: "idle", isActive: true }],
      availableTabTasks: [task],
      isLoadingTasks: true,
      onSelectTab,
      onCreateTab,
      onCloseTab,
      onReorderTab,
      agentStudioReady: false,
    });

    expect(model.tabs).toHaveLength(1);
    expect(model.availableTabTasks[0]?.id).toBe("task-1");
    expect(model.isLoadingAvailableTabTasks).toBe(true);
    expect(model.agentStudioReady).toBe(false);
    model.onSelectTab("task-1");
    expect(onSelectTab).toHaveBeenCalledWith("task-1");
    model.onReorderTab("task-1", "task-1", "before");
    expect(onReorderTab).toHaveBeenCalledWith("task-1", "task-1", "before");
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
      sessionSelectorAutofocusByValue: {
        [activeSession.sessionId]: false,
      },
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
    expect(model.sessionSelector.shouldAutofocusComposerForValue(activeSession.sessionId)).toBe(
      false,
    );

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
      sessionSelectorAutofocusByValue: {},
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
});
