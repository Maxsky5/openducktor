import { describe, expect, test } from "bun:test";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { summarizeAgentActivity } from "./agent-activity-model";

const buildSession = (
  overrides: {
    runtimeKind?: string;
    sessionId?: string;
    taskId?: string;
    role?: AgentSessionState["role"];
    scenario?: AgentSessionState["scenario"];
    startedAt?: string;
    status?: "starting" | "running" | "idle" | "error" | "stopped";
    pendingPermissions?: number;
    pendingQuestions?: number;
  } = {},
) => ({
  runtimeKind: overrides.runtimeKind ?? "opencode",
  sessionId: overrides.sessionId ?? "session-1",
  externalSessionId: `external-${overrides.sessionId ?? "session-1"}`,
  taskId: overrides.taskId ?? "task-1",
  role: overrides.role ?? ("spec" as const),
  scenario: overrides.scenario ?? ("spec_initial" as const),
  status: overrides.status ?? "idle",
  startedAt: overrides.startedAt ?? "2026-02-26T09:00:00.000Z",
  runtimeId: null,
  runId: null,
  runtimeEndpoint: "http://localhost:4096",
  workingDirectory: "/repo",
  messages: [],
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  pendingPermissions: Array.from({ length: overrides.pendingPermissions ?? 0 }, (_, index) => ({
    requestId: `perm-${index}`,
    permission: "read",
    patterns: ["*"],
  })),
  pendingQuestions: Array.from({ length: overrides.pendingQuestions ?? 0 }, (_, index) => ({
    requestId: `question-${index}`,
    questions: [],
  })),
  todos: [],
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
});

describe("summarizeAgentActivity", () => {
  test("counts active sessions from starting/running statuses", () => {
    const summary = summarizeAgentActivity({
      sessions: [
        buildSession({ sessionId: "session-1", taskId: "task-1", status: "starting" }),
        buildSession({
          sessionId: "session-2",
          taskId: "task-2",
          status: "running",
          startedAt: "2026-02-26T10:00:00.000Z",
        }),
        buildSession({ sessionId: "session-3", taskId: "task-3", status: "idle" }),
        buildSession({ sessionId: "session-4", taskId: "task-4", status: "error" }),
      ],
      taskTitleById: new Map([
        ["task-1", "One"],
        ["task-2", "Two"],
      ]),
    });

    expect(summary.activeSessionCount).toBe(2);
    expect(summary.waitingForInputCount).toBe(0);
    expect(summary.activeSessions).toHaveLength(2);
    expect(summary.activeSessions[0]).toMatchObject({
      sessionId: "session-2",
      taskId: "task-2",
      taskTitle: "Two",
    });
    expect(summary.activeSessions[1]).toMatchObject({
      sessionId: "session-1",
      taskId: "task-1",
      taskTitle: "One",
    });
  });

  test("counts waiting sessions from permissions or questions", () => {
    const summary = summarizeAgentActivity({
      sessions: [
        buildSession({
          sessionId: "session-1",
          status: "running",
          pendingPermissions: 1,
        }),
        buildSession({
          sessionId: "session-2",
          status: "idle",
          pendingQuestions: 1,
          startedAt: "2026-02-26T10:00:00.000Z",
        }),
        buildSession({ sessionId: "session-3", status: "stopped" }),
      ],
    });

    expect(summary.activeSessionCount).toBe(1);
    expect(summary.waitingForInputCount).toBe(2);
    expect(summary.waitingForInputSessions).toHaveLength(2);
    expect(summary.waitingForInputSessions[0]?.sessionId).toBe("session-2");
    expect(summary.waitingForInputSessions[1]?.sessionId).toBe("session-1");
  });
});
