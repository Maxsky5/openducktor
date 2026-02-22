import { describe, expect, test } from "bun:test";
import { buildTask } from "@/components/features/agents/agent-chat/agent-chat-test-fixtures";
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
  sessionId: "session-1",
  externalSessionId: "ext-session-1",
  taskId: "task-1",
  role: "spec",
  scenario: "spec_initial",
  status: "idle",
  startedAt: "2026-02-20T10:00:00.000Z",
  runtimeId: null,
  runId: null,
  baseUrl: "https://example.test",
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

  test("builds role enablement from workflow actions", () => {
    const task = buildTask({
      issueType: "epic",
      status: "spec_ready",
      availableActions: ["set_spec", "set_plan"],
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
      availableActions: ["open_builder"],
    });
    expect(buildRoleEnabledMapForTask(aiReviewTask)).toEqual({
      spec: false,
      planner: false,
      build: true,
      qa: true,
    });
  });

  test("builds workflow rail states from available roles and session history", () => {
    const states = buildWorkflowStateByRole({
      roleEnabledByTask: {
        spec: false,
        planner: true,
        build: false,
        qa: false,
      },
      sessionsForTask: [
        buildSession({ role: "spec", sessionId: "spec-1" }),
        buildSession({ role: "planner", sessionId: "planner-1" }),
      ],
      activeSessionRole: "planner",
    });

    expect(states).toEqual({
      spec: "done",
      planner: "current",
      build: "blocked",
      qa: "blocked",
    });
  });

  test("builds grouped session selector options", () => {
    const groups = buildSessionSelectorGroups({
      sessionsForTask: [
        buildSession({
          sessionId: "spec-1",
          role: "spec",
          scenario: "spec_revision",
          startedAt: "2026-02-22T09:20:00.000Z",
        }),
        buildSession({
          sessionId: "planner-1",
          role: "planner",
          scenario: "planner_initial",
          startedAt: "2026-02-22T10:20:00.000Z",
        }),
      ],
      scenarioLabels: {
        spec_initial: "Initial Spec",
        spec_revision: "Spec Revision",
        planner_initial: "Initial Plan",
        planner_revision: "Plan Revision",
        build_implementation_start: "Implementation Start",
        build_after_human_request_changes: "After Human Request Changes",
        build_after_qa_rejected: "After QA Rejected",
        qa_review: "QA Review",
      },
      roleLabelByRole: {
        spec: "Spec",
        planner: "Planner",
        build: "Build",
        qa: "QA",
      },
    });

    expect(groups[0]?.label).toBe("Spec");
    expect(groups[0]?.options[0]?.value).toBe("spec-1");
    expect(groups[0]?.options[0]?.label).toBe("Spec Revision · Spec");
    expect(groups[0]?.options[0]?.secondaryLabel).toBe("SPEC");
    expect(groups[1]?.label).toBe("Planner");
    expect(groups[1]?.options[0]?.value).toBe("planner-1");
    expect(groups[1]?.options[0]?.label).toBe("Initial Plan · Planner");
  });

  test("builds latest session map by role", () => {
    const sessions = [
      buildSession({ sessionId: "spec-1", role: "spec", startedAt: "2026-02-20T08:00:00.000Z" }),
      buildSession({
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

  test("builds session create options with feedback-aware build scenarios", () => {
    const options = buildSessionCreateOptions({
      roleEnabledByTask: {
        spec: false,
        planner: true,
        build: true,
        qa: false,
      },
      hasSpecDoc: true,
      hasPlanDoc: true,
      hasQaFeedback: true,
      hasHumanFeedback: false,
      createSessionDisabled: false,
      roleLabelByRole: {
        spec: "Spec",
        planner: "Planner",
        build: "Build",
        qa: "QA",
      },
      scenarioLabels: {
        spec_initial: "Initial Spec",
        spec_revision: "Revise Spec",
        planner_initial: "Initial Plan",
        planner_revision: "Revise Plan",
        build_implementation_start: "Start Implementation",
        build_after_human_request_changes: "Apply Human Changes",
        build_after_qa_rejected: "Fix QA Rejection",
        qa_review: "QA Review",
      },
    });

    expect(options.map((option) => option.scenario)).toEqual([
      "spec_revision",
      "planner_revision",
      "build_implementation_start",
      "build_after_qa_rejected",
    ]);

    const humanFeedbackOptions = buildSessionCreateOptions({
      roleEnabledByTask: {
        spec: false,
        planner: false,
        build: true,
        qa: false,
      },
      hasSpecDoc: false,
      hasPlanDoc: false,
      hasQaFeedback: false,
      hasHumanFeedback: true,
      createSessionDisabled: false,
      roleLabelByRole: {
        spec: "Spec",
        planner: "Planner",
        build: "Build",
        qa: "QA",
      },
      scenarioLabels: {
        spec_initial: "Initial Spec",
        spec_revision: "Revise Spec",
        planner_initial: "Initial Plan",
        planner_revision: "Revise Plan",
        build_implementation_start: "Start Implementation",
        build_after_human_request_changes: "Apply Human Changes",
        build_after_qa_rejected: "Fix QA Rejection",
        qa_review: "QA Review",
      },
    });

    expect(humanFeedbackOptions.map((option) => option.scenario)).toEqual([
      "build_implementation_start",
      "build_after_human_request_changes",
    ]);
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
