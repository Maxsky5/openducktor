import { describe, expect, test } from "bun:test";
import type { WorkflowAgentSessionSummary } from "@/state/agent-sessions-store";
import { summarizeAgentActivity } from "./agent-activity-read-model";

const buildSession = (
  overrides: {
    externalSessionId?: string;
    title?: string;
    runtimeKind?: WorkflowAgentSessionSummary["runtimeKind"];
    workingDirectory?: string;
    taskId?: string;
    role?: WorkflowAgentSessionSummary["role"];
    startedAt?: string;
    activityState?: WorkflowAgentSessionSummary["activityState"];
  } = {},
): WorkflowAgentSessionSummary => ({
  externalSessionId: overrides.externalSessionId ?? "session-1",
  ...(overrides.title ? { title: overrides.title } : {}),
  runtimeKind: overrides.runtimeKind ?? "opencode",
  workingDirectory: overrides.workingDirectory ?? "/repo/worktree",
  taskId: overrides.taskId ?? "task-1",
  role: overrides.role ?? ("spec" as const),
  startedAt: overrides.startedAt ?? "2026-02-26T09:00:00.000Z",
  activityState: overrides.activityState ?? "idle",
  pendingApprovalCount: 0,
  pendingQuestionCount: 0,
  selectedModel: null,
});

describe("summarizeAgentActivity", () => {
  test("counts active sessions from published activity state", () => {
    const summary = summarizeAgentActivity({
      sessions: [
        buildSession({
          externalSessionId: "session-1",
          taskId: "task-1",
          activityState: "running",
        }),
        buildSession({
          externalSessionId: "session-2",
          taskId: "task-2",
          activityState: "starting",
          startedAt: "2026-02-26T10:00:00.000Z",
        }),
        buildSession({ externalSessionId: "session-3", taskId: "task-3", activityState: "idle" }),
        buildSession({ externalSessionId: "session-4", taskId: "task-4", activityState: "error" }),
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
      externalSessionId: "session-2",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktree",
      taskId: "task-2",
      taskTitle: "Two",
      activityState: "starting",
    });
    expect(summary.activeSessions[1]).toMatchObject({
      externalSessionId: "session-1",
      taskId: "task-1",
      taskTitle: "One",
      activityState: "running",
    });
  });

  test("counts waiting sessions from published activity state", () => {
    const summary = summarizeAgentActivity({
      sessions: [
        buildSession({
          externalSessionId: "session-1",
          activityState: "waiting_input",
        }),
        buildSession({
          externalSessionId: "session-2",
          activityState: "waiting_input",
          startedAt: "2026-02-26T10:00:00.000Z",
        }),
        buildSession({ externalSessionId: "session-3", activityState: "stopped" }),
      ],
    });

    expect(summary.activeSessionCount).toBe(0);
    expect(summary.waitingForInputCount).toBe(2);
    expect(summary.waitingForInputSessions).toHaveLength(2);
    expect(summary.waitingForInputSessions[0]?.externalSessionId).toBe("session-2");
    expect(summary.waitingForInputSessions[1]?.externalSessionId).toBe("session-1");
  });

  test("publishes waiting-input activity on waiting session items", () => {
    const summary = summarizeAgentActivity({
      sessions: [
        buildSession({
          externalSessionId: "session-1",
          activityState: "waiting_input",
        }),
      ],
    });

    expect(summary.activeSessionCount).toBe(0);
    expect(summary.waitingForInputCount).toBe(1);
    expect(summary.waitingForInputSessions[0]).toMatchObject({
      externalSessionId: "session-1",
      activityState: "waiting_input",
    });
  });

  test("falls back to the task id when the title is unavailable", () => {
    const summary = summarizeAgentActivity({
      sessions: [
        buildSession({
          externalSessionId: "session-1",
          taskId: "task-missing",
          activityState: "running",
        }),
      ],
      taskTitleById: {},
    });

    expect(summary.activeSessions[0]).toMatchObject({
      taskId: "task-missing",
      taskTitle: "task-missing",
    });
  });

  test("breaks identical timestamps by session identity in descending order", () => {
    const summary = summarizeAgentActivity({
      sessions: [
        buildSession({
          externalSessionId: "shared-session",
          runtimeKind: "codex",
          workingDirectory: "/repo/codex",
          activityState: "running",
        }),
        buildSession({
          externalSessionId: "shared-session",
          runtimeKind: "opencode",
          workingDirectory: "/repo/opencode",
          activityState: "running",
        }),
      ],
    });

    expect(
      summary.activeSessions.map((session) => ({
        externalSessionId: session.externalSessionId,
        runtimeKind: session.runtimeKind,
        workingDirectory: session.workingDirectory,
      })),
    ).toEqual([
      {
        externalSessionId: "shared-session",
        runtimeKind: "opencode",
        workingDirectory: "/repo/opencode",
      },
      {
        externalSessionId: "shared-session",
        runtimeKind: "codex",
        workingDirectory: "/repo/codex",
      },
    ]);
  });

  test("ignores inactive activity states", () => {
    const summary = summarizeAgentActivity({
      sessions: [
        buildSession({ externalSessionId: "session-1", activityState: "idle" }),
        buildSession({ externalSessionId: "session-2", activityState: "error" }),
        buildSession({ externalSessionId: "session-3", activityState: "stopped" }),
      ],
    });

    expect(summary.activeSessionCount).toBe(0);
    expect(summary.waitingForInputCount).toBe(0);
    expect(summary.activeSessions).toHaveLength(0);
    expect(summary.waitingForInputSessions).toHaveLength(0);
  });
});
