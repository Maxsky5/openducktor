import { describe, expect, test } from "bun:test";
import { snapshotForClaudeSession, toClaudeDisplayParts } from "./claude-agent-sdk-session-shape";
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

describe("toClaudeDisplayParts", () => {
  test("projects Claude skill commands as source-mapped skill chips", () => {
    expect(
      toClaudeDisplayParts([
        {
          kind: "slash_command",
          command: {
            id: "grill-me",
            trigger: "grill-me",
            title: "grill-me",
            description: "Grill a plan",
            source: "skill",
            hints: [],
          },
        },
      ]),
    ).toEqual([
      {
        kind: "skill_mention",
        skill: {
          id: "grill-me",
          name: "grill-me",
          path: "grill-me",
          title: "grill-me",
          description: "Grill a plan",
        },
        sourceText: {
          value: "/grill-me",
          start: 0,
          end: 9,
        },
      },
    ]);
  });
});
