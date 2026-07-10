import { describe, expect, test } from "bun:test";
import { snapshotForClaudeSession } from "./claude-agent-sdk-session-shape";
import type { ClaudeSession } from "./claude-agent-sdk-types";

const createSession = (overrides: Partial<ClaudeSession> = {}): ClaudeSession =>
  ({
    activeSdkUserTurnCount: 0,
    activity: "running",
    externalSessionId: "session-1",
    input: {
      repoPath: "/repo",
      runtimeKind: "claude",
      workingDirectory: "/repo/worktree",
      runtimePolicy: { kind: "claude" },
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      systemPrompt: "Build",
    },
    pendingApprovals: new Map(),
    pendingQuestions: new Map(),
    queuedSdkMessages: [],
    pendingUserTurnCount: 0,
    runtimeId: "runtime-1",
    sdkState: undefined,
    startedAt: "2026-06-25T20:00:00.000Z",
    summary: {
      externalSessionId: "session-1",
      runtimeKind: "claude",
      workingDirectory: "/repo/worktree",
      role: "build",
      startedAt: "2026-06-25T20:00:00.000Z",
      status: "idle",
    },
    ...overrides,
  }) as ClaudeSession;

describe("snapshotForClaudeSession", () => {
  test("uses authoritative SDK idle state when no local turn remains pending", () => {
    const snapshot = snapshotForClaudeSession(
      createSession({
        activity: "running",
        sdkState: "idle",
      }),
    );

    expect(snapshot).toEqual(
      expect.objectContaining({
        availability: "runtime",
        classification: "idle",
      }),
    );
  });

  test("keeps sessions running while an SDK idle event belongs to a pending local turn", () => {
    const snapshot = snapshotForClaudeSession(
      createSession({
        activity: "running",
        pendingUserTurnCount: 1,
        sdkState: "idle",
      }),
    );

    expect(snapshot).toEqual(
      expect.objectContaining({
        availability: "runtime",
        classification: "running",
      }),
    );
  });
});
