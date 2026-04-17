import { describe, expect, test } from "bun:test";
import type { AgentActivitySessionSummary } from "@/state/agent-sessions-store";
import { summarizeAgentActivity } from "./agent-activity-model";

const buildSession = (
  overrides: {
    sessionId?: string;
    taskId?: string;
    role?: AgentActivitySessionSummary["role"];
    scenario?: AgentActivitySessionSummary["scenario"];
    startedAt?: string;
    status?: AgentActivitySessionSummary["status"];
    hasPendingPermissions?: boolean;
    hasPendingQuestions?: boolean;
  } = {},
): AgentActivitySessionSummary => ({
  sessionId: overrides.sessionId ?? "session-1",
  taskId: overrides.taskId ?? "task-1",
  role: overrides.role ?? ("spec" as const),
  scenario: overrides.scenario ?? ("spec_initial" as const),
  status: overrides.status ?? "idle",
  startedAt: overrides.startedAt ?? "2026-02-26T09:00:00.000Z",
  hasPendingPermissions: overrides.hasPendingPermissions ?? false,
  hasPendingQuestions: overrides.hasPendingQuestions ?? false,
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
      taskTitleById: {
        "task-1": "One",
        "task-2": "Two",
      },
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
          hasPendingPermissions: true,
        }),
        buildSession({
          sessionId: "session-2",
          status: "idle",
          hasPendingQuestions: true,
          startedAt: "2026-02-26T10:00:00.000Z",
        }),
        buildSession({ sessionId: "session-3", status: "stopped" }),
      ],
    });

    expect(summary.activeSessionCount).toBe(0);
    expect(summary.waitingForInputCount).toBe(2);
    expect(summary.waitingForInputSessions).toHaveLength(2);
    expect(summary.waitingForInputSessions[0]?.sessionId).toBe("session-2");
    expect(summary.waitingForInputSessions[1]?.sessionId).toBe("session-1");
  });

  test("prioritizes waiting for input over active status", () => {
    const summary = summarizeAgentActivity({
      sessions: [
        buildSession({
          sessionId: "session-1",
          status: "running",
          hasPendingPermissions: true,
        }),
      ],
    });

    expect(summary.activeSessionCount).toBe(0);
    expect(summary.waitingForInputCount).toBe(1);
    expect(summary.waitingForInputSessions[0]?.sessionId).toBe("session-1");
  });

  test("falls back to the task id when the title is unavailable", () => {
    const summary = summarizeAgentActivity({
      sessions: [
        buildSession({ sessionId: "session-1", taskId: "task-missing", status: "running" }),
      ],
      taskTitleById: {},
    });

    expect(summary.activeSessions[0]).toMatchObject({
      taskId: "task-missing",
      taskTitle: "task-missing",
    });
  });

  test("breaks identical timestamps by session id in descending order", () => {
    const summary = summarizeAgentActivity({
      sessions: [
        buildSession({ sessionId: "session-a", status: "running" }),
        buildSession({ sessionId: "session-z", status: "running" }),
      ],
    });

    expect(summary.activeSessions.map((session) => session.sessionId)).toEqual([
      "session-z",
      "session-a",
    ]);
  });

  test("ignores non-active statuses without pending input", () => {
    const summary = summarizeAgentActivity({
      sessions: [
        buildSession({ sessionId: "session-1", status: "idle" }),
        buildSession({ sessionId: "session-2", status: "error" }),
        buildSession({ sessionId: "session-3", status: "stopped" }),
      ],
    });

    expect(summary.activeSessionCount).toBe(0);
    expect(summary.waitingForInputCount).toBe(0);
    expect(summary.activeSessions).toHaveLength(0);
    expect(summary.waitingForInputSessions).toHaveLength(0);
  });
});
