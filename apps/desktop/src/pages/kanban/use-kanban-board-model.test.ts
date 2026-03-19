import { describe, expect, test } from "bun:test";
import type { RunSummary, TaskCard } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  buildActiveSessionsByTaskId,
  buildRunStateByTaskId,
  sortTasksByActiveSession,
} from "./use-kanban-board-model";

const createRun = (overrides: Partial<RunSummary> = {}): RunSummary => ({
  runId: "run-1",
  runtimeKind: "opencode",
  runtimeRoute: {
    type: "local_http",
    endpoint: "http://127.0.0.1:4000",
  },
  repoPath: "/repo",
  taskId: "task-1",
  branch: "main",
  worktreePath: "/tmp/worktree",
  port: 4000,
  state: "running",
  lastMessage: null,
  startedAt: "2026-03-17T10:00:00.000Z",
  ...overrides,
});

const createTaskCard = (overrides: Partial<TaskCard> = {}): TaskCard => ({
  id: "task-1",
  title: "Test Task",
  description: "",
  notes: "",
  status: "in_progress",
  priority: 2,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  assignee: undefined,
  parentId: undefined,
  subtaskIds: [],
  pullRequest: undefined,
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: false, completed: false },
    planner: { required: false, canSkip: true, available: false, completed: false },
    builder: { required: true, canSkip: false, available: false, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  updatedAt: "2026-03-17T10:00:00.000Z",
  createdAt: "2026-03-17T10:00:00.000Z",
  ...overrides,
});

const createSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  runtimeKind: "opencode",
  sessionId: "session-1",
  externalSessionId: "external-1",
  taskId: "task-1",
  role: "build",
  scenario: "build_implementation_start",
  status: "running",
  startedAt: "2026-03-17T10:00:00.000Z",
  runtimeId: null,
  runId: null,
  runtimeEndpoint: "http://localhost:4000",
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

describe("use-kanban-board-model helpers", () => {
  test("buildRunStateByTaskId keeps the newest run state per task", () => {
    const runStateByTaskId = buildRunStateByTaskId([
      createRun({
        runId: "run-newer",
        taskId: "task-1",
        state: "stopped",
        startedAt: "2026-03-17T11:00:00.000Z",
      }),
      createRun({
        runId: "run-older",
        taskId: "task-1",
        state: "running",
        startedAt: "2026-03-17T09:00:00.000Z",
      }),
      createRun({
        runId: "run-task-2",
        taskId: "task-2",
        state: "blocked",
      }),
    ]);

    expect(runStateByTaskId.get("task-1")).toBe("stopped");
    expect(runStateByTaskId.get("task-2")).toBe("blocked");
  });

  test("buildActiveSessionsByTaskId filters non-active sessions and sorts active ones", () => {
    const activeSessionsByTaskId = buildActiveSessionsByTaskId([
      createSession({
        sessionId: "session-starting",
        status: "starting",
        startedAt: "2026-03-17T11:00:00.000Z",
      }),
      createSession({
        sessionId: "session-running-older",
        status: "running",
        startedAt: "2026-03-17T09:00:00.000Z",
      }),
      createSession({
        sessionId: "session-running-newer",
        status: "running",
        startedAt: "2026-03-17T10:00:00.000Z",
      }),
      createSession({
        sessionId: "session-idle",
        status: "idle",
      }),
    ]);

    expect(activeSessionsByTaskId.get("task-1")?.map((session) => session.sessionId)).toEqual([
      "session-running-newer",
      "session-running-older",
      "session-starting",
    ]);
  });

  test("sortTasksByActiveSession puts active tasks above inactive tasks", () => {
    const tasks = [
      createTaskCard({ id: "task-no-session" }),
      createTaskCard({ id: "task-with-session" }),
      createTaskCard({ id: "task-another-no-session" }),
    ];
    const activeSessionsByTaskId = new Map<string, AgentSessionState[]>([
      ["task-with-session", [createSession({ taskId: "task-with-session" })]],
    ]);

    const sorted = sortTasksByActiveSession(tasks, activeSessionsByTaskId);

    expect(sorted.map((t) => t.id)).toEqual([
      "task-with-session",
      "task-no-session",
      "task-another-no-session",
    ]);
  });

  test("sortTasksByActiveSession preserves relative order within groups (stable sort)", () => {
    const tasks = [
      createTaskCard({ id: "task-1-no-session" }),
      createTaskCard({ id: "task-2-with-session" }),
      createTaskCard({ id: "task-3-no-session" }),
      createTaskCard({ id: "task-4-with-session" }),
    ];
    const activeSessionsByTaskId = new Map<string, AgentSessionState[]>([
      ["task-2-with-session", [createSession({ taskId: "task-2-with-session" })]],
      ["task-4-with-session", [createSession({ taskId: "task-4-with-session" })]],
    ]);

    const sorted = sortTasksByActiveSession(tasks, activeSessionsByTaskId);

    expect(sorted.map((t) => t.id)).toEqual([
      "task-2-with-session",
      "task-4-with-session",
      "task-1-no-session",
      "task-3-no-session",
    ]);
  });

  test("sortTasksByActiveSession handles empty columns gracefully", () => {
    const tasks: TaskCard[] = [];
    const activeSessionsByTaskId = new Map<string, AgentSessionState[]>();

    const sorted = sortTasksByActiveSession(tasks, activeSessionsByTaskId);

    expect(sorted).toEqual([]);
  });

  test("sortTasksByActiveSession handles no active sessions gracefully", () => {
    const tasks = [createTaskCard({ id: "task-1" }), createTaskCard({ id: "task-2" })];
    const activeSessionsByTaskId = new Map<string, AgentSessionState[]>();

    const sorted = sortTasksByActiveSession(tasks, activeSessionsByTaskId);

    expect(sorted.map((t) => t.id)).toEqual(["task-1", "task-2"]);
  });
});
