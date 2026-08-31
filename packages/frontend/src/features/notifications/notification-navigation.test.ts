import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord, NotificationNavigationTarget } from "@openducktor/contracts";
import { addNotificationAttention, matchesNotificationSession } from "./notification-navigation";

const session: AgentSessionRecord = {
  externalSessionId: "session-1",
  role: "build",
  startedAt: "2026-08-31T10:00:00.000Z",
  runtimeKind: "codex",
  workingDirectory: "/repo/worktree",
  selectedModel: null,
};

const target: Extract<NotificationNavigationTarget, { type: "pending_input" }> = {
  type: "pending_input",
  repoPath: "/repo",
  taskId: "task-1",
  session: {
    externalSessionId: "session-1",
    runtimeKind: "codex",
    workingDirectory: "/repo/worktree",
  },
  inputKind: "permission",
  requestId: "request-1",
};

describe("notification navigation", () => {
  test("requires the full session identity", () => {
    expect(matchesNotificationSession(session, target)).toBe(true);
    expect(
      matchesNotificationSession(session, {
        ...target,
        session: { ...target.session, runtimeKind: "opencode" },
      }),
    ).toBe(false);
    expect(
      matchesNotificationSession(session, {
        ...target,
        session: { ...target.session, workingDirectory: "/repo/other" },
      }),
    ).toBe(false);
  });

  test("adds only transient attention keys to the Agent Studio URL", () => {
    const href = addNotificationAttention(
      "/agents?task=task-1&session=session-1&agent=build",
      target,
    );
    expect(href).toBe(
      "/agents?task=task-1&session=session-1&agent=build&attention=permission&attentionId=request-1",
    );
    expect(href).not.toContain("runtimeKind");
    expect(href).not.toContain("workingDirectory");
  });
});
