import { describe, expect, test } from "bun:test";
import {
  classifyLiveAgentSessionSnapshot,
  toAgentSessionPresenceSnapshotFromLiveSnapshot,
  toLiveAgentSessionRuntimeStatus,
  toPersistedOnlyAgentSessionPresenceSnapshot,
} from "./agent-session-presence";

describe("agent-session-presence", () => {
  test("classifies pending questions before approvals and retry status", () => {
    const classification = classifyLiveAgentSessionSnapshot({
      status: { type: "retry", attempt: 2, message: "try again", nextEpochMs: 1234 },
      pendingApprovals: [{ requestId: "approval-1" }],
      pendingQuestions: [{ requestId: "question-1" }],
    });

    expect(classification).toBe("waiting_for_question");
    expect(toLiveAgentSessionRuntimeStatus(classification)).toBe("idle");
  });

  test("classifies pending approvals before retry status", () => {
    const classification = classifyLiveAgentSessionSnapshot({
      status: { type: "retry", attempt: 2, message: "try again", nextEpochMs: 1234 },
      pendingApprovals: [{ requestId: "approval-1" }],
      pendingQuestions: [],
    });

    expect(classification).toBe("waiting_for_permission");
    expect(toLiveAgentSessionRuntimeStatus(classification)).toBe("idle");
  });

  test("classifies retry as retrying and runtime-running", () => {
    const classification = classifyLiveAgentSessionSnapshot({
      status: { type: "retry", attempt: 2, message: "try again", nextEpochMs: 1234 },
      pendingApprovals: [],
      pendingQuestions: [],
    });

    expect(classification).toBe("retrying");
    expect(toLiveAgentSessionRuntimeStatus(classification)).toBe("running");
  });

  test("classifies busy as running", () => {
    const classification = classifyLiveAgentSessionSnapshot({
      status: { type: "busy" },
      pendingApprovals: [],
      pendingQuestions: [],
    });

    expect(classification).toBe("running");
    expect(toLiveAgentSessionRuntimeStatus(classification)).toBe("running");
  });

  test("classifies idle without pending input as idle", () => {
    const classification = classifyLiveAgentSessionSnapshot({
      status: { type: "idle" },
      pendingApprovals: [],
      pendingQuestions: [],
    });

    expect(classification).toBe("idle");
    expect(toLiveAgentSessionRuntimeStatus(classification)).toBe("idle");
  });

  test("builds live snapshot from a runtime snapshot", () => {
    const snapshot = toAgentSessionPresenceSnapshotFromLiveSnapshot({
      ref: {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      },
      runtimeId: "runtime-1",
      snapshot: {
        externalSessionId: "session-1",
        title: "Build session",
        workingDirectory: "/repo/worktree",
        startedAt: "2026-02-22T12:00:00.000Z",
        status: { type: "busy" },
        pendingApprovals: [],
        pendingQuestions: [],
      },
    });

    expect(snapshot).toEqual({
      presence: "runtime",
      classification: "running",
      ref: {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      },
      runtimeId: "runtime-1",
      title: "Build session",
      startedAt: "2026-02-22T12:00:00.000Z",
      status: { type: "busy" },
      agentSessionStatus: "running",
      pendingApprovals: [],
      pendingQuestions: [],
    });
  });

  test("builds stale snapshot when a runtime snapshot is absent", () => {
    const ref = {
      repoPath: "/repo",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo/worktree",
      externalSessionId: "session-1",
    };

    expect(
      toAgentSessionPresenceSnapshotFromLiveSnapshot({
        ref,
        runtimeId: "runtime-1",
        snapshot: null,
      }),
    ).toEqual({
      presence: "stale",
      classification: "stale",
      ref,
      runtimeId: "runtime-1",
      pendingApprovals: [],
      pendingQuestions: [],
    });
  });

  test("builds persisted-only snapshot for records without a live runtime", () => {
    const ref = {
      repoPath: "/repo",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo/worktree",
      externalSessionId: "session-1",
    };

    expect(
      toPersistedOnlyAgentSessionPresenceSnapshot({
        ref,
        reason: "runtime missing",
      }),
    ).toEqual({
      presence: "persisted_only",
      classification: "persisted_only",
      ref,
      runtimeId: null,
      reason: "runtime missing",
      pendingApprovals: [],
      pendingQuestions: [],
    });
  });
});
