import { describe, expect, test } from "bun:test";
import { buildTask } from "@/components/features/agents/agent-chat/agent-chat-test-fixtures";
import { AGENT_ROLE_LABELS } from "@/types";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  buildLatestSessionByRoleMap,
  buildLatestSessionByTaskMap,
  buildRoleEnabledMapForTask,
  buildSessionCreateOptions,
  buildSessionSelectorGroups,
  buildTaskTabs,
  buildWorkflowStateByRole,
  canPersistTaskTabs,
  closeTaskTab,
  ensureActiveTaskTab,
  getAvailableTabTasks,
  getTabStatusFromSession,
  parsePersistedTaskTabs,
  resolveFallbackTaskId,
  toPersistedTaskTabs,
} from "./agents-page-session-tabs";

const buildSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  runtimeKind: "opencode",
  sessionId: "session-1",
  externalSessionId: "ext-session-1",
  taskId: "task-1",
  role: "spec",
  scenario: "spec_initial",
  status: "idle",
  startedAt: "2026-02-20T10:00:00.000Z",
  runtimeId: null,
  runId: null,
  runtimeEndpoint: "https://example.test",
  workingDirectory: "/tmp/work",
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

describe("agents-page-session-tabs", () => {
  test("selects latest session per task", () => {
    const map = buildLatestSessionByTaskMap([
      buildSession({ taskId: "task-1", sessionId: "older", startedAt: "2026-02-20T09:00:00.000Z" }),
      buildSession({ taskId: "task-1", sessionId: "newer", startedAt: "2026-02-20T11:00:00.000Z" }),
      buildSession({ taskId: "task-2", sessionId: "task-2-session" }),
    ]);

    expect(map.get("task-1")?.sessionId).toBe("newer");
    expect(map.get("task-2")?.sessionId).toBe("task-2-session");
  });

  test("uses deterministic tiebreaker when timestamps are equal", () => {
    const map = buildLatestSessionByTaskMap([
      buildSession({ taskId: "task-1", sessionId: "first", startedAt: "2026-02-20T10:00:00.000Z" }),
      buildSession({
        taskId: "task-1",
        sessionId: "second",
        startedAt: "2026-02-20T10:00:00.000Z",
      }),
    ]);

    expect(map.get("task-1")?.sessionId).toBe("second");
  });

  test("prioritizes waiting-input status over running", () => {
    const status = getTabStatusFromSession(
      buildSession({
        status: "running",
        pendingQuestions: [{ requestId: "q-1", questions: [] }],
      }),
    );

    expect(status).toBe("waiting_input");
  });

  test("appends active task tab only once", () => {
    const tabIds = ensureActiveTaskTab(["task-1"], "task-2");
    expect(tabIds).toEqual(["task-1", "task-2"]);
    expect(ensureActiveTaskTab(tabIds, "task-2")).toEqual(["task-1", "task-2"]);
  });

  test("parses persisted task tabs and deduplicates invalid entries", () => {
    expect(parsePersistedTaskTabs(null)).toEqual({ tabs: [], activeTaskId: null });
    expect(parsePersistedTaskTabs("not-json")).toEqual({ tabs: [], activeTaskId: null });
    expect(parsePersistedTaskTabs(JSON.stringify({ tabs: ["task-1"] }))).toEqual({
      tabs: ["task-1"],
      activeTaskId: null,
    });
    expect(
      parsePersistedTaskTabs(
        JSON.stringify(["task-1", "", "task-2", "task-1", 42, "task-3", "   "]),
      ),
    ).toEqual({
      tabs: ["task-1", "task-2", "task-3"],
      activeTaskId: null,
    });
    expect(
      parsePersistedTaskTabs(
        JSON.stringify({
          tabs: ["task-1", "task-2", "task-1"],
          activeTaskId: "task-2",
        }),
      ),
    ).toEqual({
      tabs: ["task-1", "task-2"],
      activeTaskId: "task-2",
    });
  });

  test("serializes persisted tabs with valid active task id", () => {
    const serialized = toPersistedTaskTabs({
      tabs: ["task-1", "task-2", "task-1"],
      activeTaskId: "task-2",
    });

    expect(parsePersistedTaskTabs(serialized)).toEqual({
      tabs: ["task-1", "task-2"],
      activeTaskId: "task-2",
    });

    const serializedInvalidActive = toPersistedTaskTabs({
      tabs: ["task-1"],
      activeTaskId: "task-2",
    });
    expect(parsePersistedTaskTabs(serializedInvalidActive)).toEqual({
      tabs: ["task-1"],
      activeTaskId: null,
    });
  });

  test("prefers persisted active tab for fallback selection", () => {
    expect(
      resolveFallbackTaskId({
        tabTaskIds: ["task-1", "task-2"],
        persistedActiveTaskId: "task-2",
      }),
    ).toBe("task-2");

    expect(
      resolveFallbackTaskId({
        tabTaskIds: ["task-1", "task-2"],
        persistedActiveTaskId: "task-3",
      }),
    ).toBe("task-1");
  });

  test("persists tabs only after hydration for the active repo", () => {
    expect(canPersistTaskTabs(null, null)).toBe(false);
    expect(canPersistTaskTabs("/repo-a", null)).toBe(false);
    expect(canPersistTaskTabs("/repo-a", "/repo-b")).toBe(false);
    expect(canPersistTaskTabs("/repo-a", "/repo-a")).toBe(true);
  });

  test("builds role enablement from backend workflow payload", () => {
    const task = buildTask({
      issueType: "epic",
      status: "spec_ready",
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: false },
        builder: { required: true, canSkip: false, available: false, completed: false },
        qa: { required: true, canSkip: false, available: false, completed: false },
      },
    });
    expect(buildRoleEnabledMapForTask(task)).toEqual({
      spec: true,
      planner: true,
      build: false,
      qa: false,
    });

    const aiReviewTask = buildTask({
      issueType: "feature",
      status: "ai_review",
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: true },
        builder: { required: true, canSkip: false, available: true, completed: true },
        qa: { required: true, canSkip: false, available: true, completed: false },
      },
    });
    expect(buildRoleEnabledMapForTask(aiReviewTask)).toEqual({
      spec: true,
      planner: true,
      build: true,
      qa: true,
    });
  });

  test("builds workflow rail states from backend-provided workflow fields", () => {
    const states = buildWorkflowStateByRole({
      task: null,
      roleWorkflowsByTask: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: true },
        build: { required: true, canSkip: false, available: false, completed: false },
        qa: { required: false, canSkip: true, available: false, completed: false },
      },
      latestSessionByRole: {
        spec: null,
        planner: null,
        build: null,
        qa: null,
      },
    });

    expect(states).toEqual({
      spec: "done",
      planner: "done",
      build: "blocked",
      qa: "optional",
    });
  });

  test("marks workflow role as in_progress when latest role session is started but not completed", () => {
    const states = buildWorkflowStateByRole({
      task: null,
      roleWorkflowsByTask: {
        spec: { required: true, canSkip: false, available: false, completed: false },
        planner: { required: true, canSkip: false, available: true, completed: false },
        build: { required: true, canSkip: false, available: false, completed: false },
        qa: { required: false, canSkip: true, available: false, completed: false },
      },
      latestSessionByRole: {
        spec: null,
        planner: buildSession({ role: "planner", status: "idle" }),
        build: null,
        qa: null,
      },
    });

    expect(states).toEqual({
      spec: "blocked",
      planner: "in_progress",
      build: "blocked",
      qa: "optional",
    });
  });

  test("does not mark unavailable roles as in_progress when a session exists", () => {
    const states = buildWorkflowStateByRole({
      task: null,
      roleWorkflowsByTask: {
        spec: { required: true, canSkip: false, available: false, completed: false },
        planner: { required: true, canSkip: false, available: false, completed: false },
        build: { required: true, canSkip: false, available: false, completed: false },
        qa: { required: false, canSkip: true, available: false, completed: false },
      },
      latestSessionByRole: {
        spec: null,
        planner: null,
        build: null,
        qa: buildSession({ role: "qa", status: "idle", scenario: "qa_review" }),
      },
    });

    expect(states).toEqual({
      spec: "blocked",
      planner: "blocked",
      build: "blocked",
      qa: "optional",
    });
  });

  test("marks qa step as rejected when task is back in progress after qa rejection", () => {
    const task = buildTask({
      issueType: "feature",
      status: "in_progress",
      documentSummary: {
        spec: { has: true, updatedAt: "2026-02-22T08:00:00.000Z" },
        plan: { has: true, updatedAt: "2026-02-22T08:10:00.000Z" },
        qaReport: { has: true, updatedAt: "2026-02-22T08:20:00.000Z", verdict: "rejected" },
      },
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: true },
        builder: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: true, canSkip: false, available: false, completed: false },
      },
    });
    const states = buildWorkflowStateByRole({
      task,
      roleWorkflowsByTask: {
        spec: task.agentWorkflows.spec,
        planner: task.agentWorkflows.planner,
        build: task.agentWorkflows.builder,
        qa: task.agentWorkflows.qa,
      },
      latestSessionByRole: {
        spec: null,
        planner: null,
        build: null,
        qa: buildSession({ role: "qa", status: "idle", scenario: "qa_review" }),
      },
    });

    expect(states).toEqual({
      spec: "done",
      planner: "done",
      build: "done",
      qa: "rejected",
    });
  });

  test("keeps builder done after completed qa-rework session even before task status catches up", () => {
    const task = buildTask({
      status: "in_progress",
      documentSummary: {
        spec: { has: true, updatedAt: "2026-02-22T09:00:00.000Z" },
        plan: { has: true, updatedAt: "2026-02-22T09:30:00.000Z" },
        qaReport: { has: true, updatedAt: "2026-02-22T10:00:00.000Z", verdict: "approved" },
      },
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: true },
        builder: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: true, canSkip: false, available: false, completed: true },
      },
    });

    const states = buildWorkflowStateByRole({
      task,
      roleWorkflowsByTask: {
        spec: task.agentWorkflows.spec,
        planner: task.agentWorkflows.planner,
        build: task.agentWorkflows.builder,
        qa: task.agentWorkflows.qa,
      },
      latestSessionByRole: {
        spec: buildSession({ role: "spec", status: "idle" }),
        planner: buildSession({ role: "planner", status: "idle" }),
        build: buildSession({
          role: "build",
          status: "idle",
          scenario: "build_after_qa_rejected",
          startedAt: "2026-02-22T11:00:00.000Z",
        }),
        qa: buildSession({
          role: "qa",
          status: "idle",
          scenario: "qa_review",
          startedAt: "2026-02-22T10:00:00.000Z",
        }),
      },
    });

    expect(states).toEqual({
      spec: "done",
      planner: "done",
      build: "done",
      qa: "done",
    });
  });

  test("builds grouped session selector options", () => {
    const groups = buildSessionSelectorGroups({
      sessionsForTask: [
        buildSession({
          runtimeKind: "opencode",
          sessionId: "spec-1",
          role: "spec",
          scenario: "spec_initial",
          startedAt: "2026-02-22T09:20:00.000Z",
        }),
        buildSession({
          runtimeKind: "opencode",
          sessionId: "spec-2",
          role: "spec",
          scenario: "spec_initial",
          startedAt: "2026-02-22T08:20:00.000Z",
        }),
        buildSession({
          runtimeKind: "opencode",
          sessionId: "planner-1",
          role: "planner",
          scenario: "planner_initial",
          startedAt: "2026-02-22T10:20:00.000Z",
        }),
      ],
      scenarioLabels: {
        spec_initial: "Spec",
        planner_initial: "Planner",
        build_implementation_start: "Implementation Start",
        build_after_human_request_changes: "After Human Request Changes",
        build_after_qa_rejected: "After QA Rejected",
        build_rebase_conflict_resolution: "Resolve Rebase Conflict",
        qa_review: "QA Review",
      },
      roleLabelByRole: { ...AGENT_ROLE_LABELS },
    });

    expect(groups[0]?.label).toBe("Spec");
    expect(groups[0]?.options[0]?.value).toBe("spec-1");
    expect(groups[0]?.options[0]?.label).toBe("Spec #2");
    expect(groups[0]?.options[1]?.value).toBe("spec-2");
    expect(groups[0]?.options[1]?.label).toBe("Spec #1");
    expect(groups[0]?.options[0]?.secondaryLabel).toBeUndefined();
    expect(groups[1]?.label).toBe("Planner");
    expect(groups[1]?.options[0]?.value).toBe("planner-1");
    expect(groups[1]?.options[0]?.label).toBe("Planner #1");
  });

  test("builds latest session map by role", () => {
    const sessions = [
      buildSession({ sessionId: "spec-1", role: "spec", startedAt: "2026-02-20T08:00:00.000Z" }),
      buildSession({
        runtimeKind: "opencode",
        sessionId: "planner-1",
        role: "planner",
        startedAt: "2026-02-20T10:00:00.000Z",
      }),
      buildSession({ sessionId: "build-1", role: "build", startedAt: "2026-02-20T09:00:00.000Z" }),
    ];

    const latestByRole = buildLatestSessionByRoleMap(sessions);
    expect(latestByRole.spec?.sessionId).toBe("spec-1");
    expect(latestByRole.planner?.sessionId).toBe("planner-1");
    expect(latestByRole.build?.sessionId).toBe("build-1");
    expect(latestByRole.qa).toBeNull();
  });

  test("builds latest session map by role using newest startedAt", () => {
    const sessions = [
      buildSession({
        sessionId: "build-older",
        role: "build",
        scenario: "build_implementation_start",
        startedAt: "2026-02-20T09:00:00.000Z",
      }),
      buildSession({
        sessionId: "build-newer",
        role: "build",
        scenario: "build_after_qa_rejected",
        startedAt: "2026-02-20T11:00:00.000Z",
      }),
    ];

    const latestByRole = buildLatestSessionByRoleMap(sessions);

    expect(latestByRole.build?.sessionId).toBe("build-newer");
  });

  test("builds session create options without continue actions", () => {
    const options = buildSessionCreateOptions({
      roleEnabledByTask: {
        spec: false,
        planner: true,
        build: true,
        qa: false,
      },
      hasQaRejection: true,
      hasHumanFeedback: false,
      createSessionDisabled: false,
      roleLabelByRole: { ...AGENT_ROLE_LABELS },
      scenarioLabels: {
        spec_initial: "Spec",
        planner_initial: "Planner",
        build_implementation_start: "Start Implementation",
        build_after_human_request_changes: "Apply Human Changes",
        build_after_qa_rejected: "Fix QA Rejection",
        build_rebase_conflict_resolution: "Resolve Rebase Conflict",
        qa_review: "QA Review",
      },
    });

    expect(options.map((option) => option.scenario)).toEqual([
      "planner_initial",
      "build_implementation_start",
      "build_after_qa_rejected",
    ]);
    expect(options.some((option) => option.label.includes("Continue"))).toBe(false);

    const plannerCompletedOptions = buildSessionCreateOptions({
      roleEnabledByTask: {
        spec: false,
        planner: false,
        build: true,
        qa: false,
      },
      hasQaRejection: false,
      hasHumanFeedback: true,
      createSessionDisabled: false,
      roleLabelByRole: { ...AGENT_ROLE_LABELS },
      scenarioLabels: {
        spec_initial: "Spec",
        planner_initial: "Planner",
        build_implementation_start: "Start Implementation",
        build_after_human_request_changes: "Apply Human Changes",
        build_after_qa_rejected: "Fix QA Rejection",
        build_rebase_conflict_resolution: "Resolve Rebase Conflict",
        qa_review: "QA Review",
      },
    });

    expect(plannerCompletedOptions.map((option) => option.scenario)).toEqual([
      "build_implementation_start",
      "build_after_human_request_changes",
    ]);
    expect(plannerCompletedOptions.some((option) => option.label.includes("Continue"))).toBe(false);
  });

  test("filters available tasks by opened tab ids", () => {
    const tasks = [
      buildTask({ id: "task-1", title: "One" }),
      buildTask({ id: "task-2", title: "Two" }),
      buildTask({ id: "task-3", title: "Three" }),
    ];

    const available = getAvailableTabTasks(tasks, ["task-2"]);
    expect(available.map((task) => task.id)).toEqual(["task-1", "task-3"]);
  });

  test("builds tabs with fallback title and active marker", () => {
    const latestByTask = buildLatestSessionByTaskMap([
      buildSession({ taskId: "task-1", status: "running" }),
      buildSession({
        taskId: "task-2",
        status: "idle",
        pendingPermissions: [{ requestId: "p", permission: "bash", patterns: [] }],
      }),
    ]);

    const tabs = buildTaskTabs({
      tabTaskIds: ["task-1", "task-2", "task-ghost"],
      tasks: [buildTask({ id: "task-1", title: "One" }), buildTask({ id: "task-2", title: "Two" })],
      latestSessionByTaskId: latestByTask,
      activeTaskId: "task-2",
    });

    expect(tabs).toEqual([
      {
        taskId: "task-1",
        taskTitle: "One",
        status: "working",
        isActive: false,
      },
      {
        taskId: "task-2",
        taskTitle: "Two",
        status: "waiting_input",
        isActive: true,
      },
      {
        taskId: "task-ghost",
        taskTitle: "task-ghost",
        status: "idle",
        isActive: false,
      },
    ]);
  });

  test("closing active tab picks adjacent right tab", () => {
    const result = closeTaskTab({
      tabTaskIds: ["task-1", "task-2", "task-3"],
      taskIdToClose: "task-2",
      activeTaskId: "task-2",
    });

    expect(result).toEqual({
      nextTabTaskIds: ["task-1", "task-3"],
      nextActiveTaskId: "task-3",
    });
  });

  test("closing last active tab falls back to previous tab", () => {
    const result = closeTaskTab({
      tabTaskIds: ["task-1", "task-2", "task-3"],
      taskIdToClose: "task-3",
      activeTaskId: "task-3",
    });

    expect(result).toEqual({
      nextTabTaskIds: ["task-1", "task-2"],
      nextActiveTaskId: "task-2",
    });
  });
});
