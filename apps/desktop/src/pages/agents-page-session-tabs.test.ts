import { describe, expect, test } from "bun:test";
import { buildTask } from "@/components/features/agents/agent-chat/agent-chat-test-fixtures";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  buildLatestSessionByTaskMap,
  buildTaskTabs,
  closeTaskTab,
  ensureActiveTaskTab,
  getAvailableTabTasks,
  getTabStatusFromSession,
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
