import { describe, expect, test } from "bun:test";
import type { RunSummary, TaskCard } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  buildActiveTaskSessionContextByTaskId,
  buildRunStateByTaskId,
  buildTaskActivityStateByTaskId,
  buildTaskSessionsByTaskId,
  sortTasksByActivityState,
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
  repoPath: overrides.repoPath ?? "/repo",
  role: "build",
  scenario: "build_implementation_start",
  status: "running",
  startedAt: "2026-03-17T10:00:00.000Z",
  runtimeId: null,
  runId: null,
  runtimeRoute: { type: "local_http", endpoint: "http://localhost:4000" },
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

  test("buildTaskSessionsByTaskId keeps waiting-input sessions even when they are idle", () => {
    const taskSessionsByTaskId = buildTaskSessionsByTaskId([
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
        pendingQuestions: [
          {
            requestId: "question-1",
            questions: [
              {
                header: "Approval",
                question: "Need approval",
                options: [{ label: "Approve", description: "Approve the change" }],
              },
            ],
          },
        ],
      }),
      createSession({
        sessionId: "session-idle",
        status: "idle",
        pendingPermissions: [
          {
            requestId: "permission-2",
            permission: "tool",
            patterns: ["odt_build_completed"],
          },
        ],
      }),
    ]);

    expect(taskSessionsByTaskId.get("task-1")).toEqual([
      expect.objectContaining({
        sessionId: "session-running-newer",
        presentationState: "waiting_input",
      }),
      expect.objectContaining({
        sessionId: "session-idle",
        status: "idle",
        presentationState: "waiting_input",
      }),
      expect.objectContaining({
        sessionId: "session-running-older",
        presentationState: "active",
      }),
      expect.objectContaining({
        sessionId: "session-starting",
        presentationState: "active",
      }),
    ]);
  });

  test("sortTasksByActivityState puts waiting-input tasks above active and inactive tasks", () => {
    const tasks = [
      createTaskCard({ id: "task-no-session" }),
      createTaskCard({ id: "task-waiting" }),
      createTaskCard({ id: "task-with-session" }),
      createTaskCard({ id: "task-another-no-session" }),
    ];
    const taskSessionsByTaskId = buildTaskSessionsByTaskId([
      createSession({
        taskId: "task-waiting",
        pendingPermissions: [
          {
            requestId: "permission-1",
            permission: "tool",
            patterns: ["odt_read_task"],
          },
        ],
      }),
      createSession({ taskId: "task-with-session", sessionId: "session-2" }),
    ]);
    const taskActivityStateByTaskId = buildTaskActivityStateByTaskId(tasks, taskSessionsByTaskId);

    const sorted = sortTasksByActivityState(tasks, taskActivityStateByTaskId);

    expect(sorted.map((t) => t.id)).toEqual([
      "task-waiting",
      "task-with-session",
      "task-no-session",
      "task-another-no-session",
    ]);
  });

  test("sortTasksByActivityState preserves relative order within groups", () => {
    const tasks = [
      createTaskCard({ id: "task-1-waiting" }),
      createTaskCard({ id: "task-2-active" }),
      createTaskCard({ id: "task-3-idle" }),
      createTaskCard({ id: "task-4-waiting" }),
      createTaskCard({ id: "task-5-active" }),
      createTaskCard({ id: "task-6-idle" }),
    ];
    const taskSessionsByTaskId = buildTaskSessionsByTaskId([
      createSession({
        taskId: "task-1-waiting",
        sessionId: "session-1",
        pendingQuestions: [
          {
            requestId: "question-1",
            questions: [
              {
                header: "Approval",
                question: "Need approval",
                options: [{ label: "Approve", description: "Approve the change" }],
              },
            ],
          },
        ],
      }),
      createSession({ taskId: "task-2-active", sessionId: "session-2" }),
      createSession({
        taskId: "task-4-waiting",
        sessionId: "session-4",
        pendingPermissions: [
          {
            requestId: "permission-1",
            permission: "tool",
            patterns: ["odt_read_task"],
          },
        ],
      }),
      createSession({ taskId: "task-5-active", sessionId: "session-5" }),
    ]);
    const taskActivityStateByTaskId = buildTaskActivityStateByTaskId(tasks, taskSessionsByTaskId);

    const sorted = sortTasksByActivityState(tasks, taskActivityStateByTaskId);

    expect(sorted.map((t) => t.id)).toEqual([
      "task-1-waiting",
      "task-4-waiting",
      "task-2-active",
      "task-5-active",
      "task-3-idle",
      "task-6-idle",
    ]);
  });

  test("sortTasksByActivityState handles empty columns gracefully", () => {
    const tasks: TaskCard[] = [];
    const taskActivityStateByTaskId = new Map<string, "idle" | "active" | "waiting_input">();

    const sorted = sortTasksByActivityState(tasks, taskActivityStateByTaskId);

    expect(sorted).toEqual([]);
  });

  test("sortTasksByActivityState handles no active sessions gracefully", () => {
    const tasks = [createTaskCard({ id: "task-1" }), createTaskCard({ id: "task-2" })];
    const taskActivityStateByTaskId = buildTaskActivityStateByTaskId(tasks, new Map());

    const sorted = sortTasksByActivityState(tasks, taskActivityStateByTaskId);

    expect(sorted.map((t) => t.id)).toEqual(["task-1", "task-2"]);
  });

  test("sortTasksByActivityState throws when a task is missing activity state", () => {
    const tasks = [createTaskCard({ id: "task-1" })];

    expect(() => sortTasksByActivityState(tasks, new Map())).toThrow(
      "Missing Kanban task activity state for task task-1",
    );
  });

  test("buildTaskActivityStateByTaskId marks tasks as waiting input when any displayed session is waiting", () => {
    const tasks = [
      createTaskCard({ id: "task-waiting" }),
      createTaskCard({ id: "task-active" }),
      createTaskCard({ id: "task-idle" }),
    ];
    const taskSessionsByTaskId = buildTaskSessionsByTaskId([
      createSession({ taskId: "task-waiting", sessionId: "session-waiting" }),
      createSession({
        taskId: "task-waiting",
        sessionId: "session-question",
        status: "idle",
        pendingQuestions: [
          {
            requestId: "question-2",
            questions: [
              {
                header: "Question",
                question: "Need answer",
                options: [{ label: "Answer", description: "Answer the question" }],
              },
            ],
          },
        ],
      }),
      createSession({ taskId: "task-active", sessionId: "session-active" }),
    ]);

    const taskActivityStateByTaskId = buildTaskActivityStateByTaskId(tasks, taskSessionsByTaskId);

    expect(taskActivityStateByTaskId.get("task-waiting")).toBe("waiting_input");
    expect(taskActivityStateByTaskId.get("task-active")).toBe("active");
    expect(taskActivityStateByTaskId.get("task-idle")).toBe("idle");
  });

  test("buildActiveTaskSessionContextByTaskId prioritizes waiting-input session role", () => {
    const activeTaskSessionContextByTaskId = buildActiveTaskSessionContextByTaskId([
      createSession({
        taskId: "task-1",
        role: "build",
        sessionId: "build-running",
        status: "running",
        startedAt: "2026-03-21T10:00:00.000Z",
      }),
      createSession({
        taskId: "task-1",
        role: "qa",
        sessionId: "qa-waiting",
        status: "idle",
        startedAt: "2026-03-20T10:00:00.000Z",
        pendingQuestions: [
          {
            requestId: "question-qa",
            questions: [
              {
                header: "Approval",
                question: "Need QA input",
                options: [{ label: "Approve", description: "Approve" }],
              },
            ],
          },
        ],
      }),
    ]);

    expect(activeTaskSessionContextByTaskId.get("task-1")).toEqual({
      role: "qa",
      presentationState: "waiting_input",
    });
  });
});
