import { describe, expect, test } from "bun:test";
import {
  classifyLiveAgentSessionSnapshot,
  toLiveAgentSessionRuntimeStatus,
  toLiveSessionTruthFromSnapshot,
  toPersistedOnlyLiveSessionTruth,
} from "./live-session-classification";

describe("live-session-classification", () => {
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

  test("builds live truth from a runtime snapshot", () => {
    const truth = toLiveSessionTruthFromSnapshot({
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

    expect(truth).toEqual({
      type: "live",
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

  test("builds stale truth when a runtime snapshot is absent", () => {
    const ref = {
      repoPath: "/repo",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo/worktree",
      externalSessionId: "session-1",
    };

    expect(
      toLiveSessionTruthFromSnapshot({
        ref,
        runtimeId: "runtime-1",
        snapshot: null,
      }),
    ).toEqual({
      type: "stale",
      classification: "stale",
      ref,
      runtimeId: "runtime-1",
      pendingApprovals: [],
      pendingQuestions: [],
    });
  });

  test("builds persisted-only truth for records without a live runtime", () => {
    const ref = {
      repoPath: "/repo",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo/worktree",
      externalSessionId: "session-1",
    };

    expect(
      toPersistedOnlyLiveSessionTruth({
        ref,
        reason: "runtime missing",
      }),
    ).toEqual({
      type: "persisted_only",
      classification: "persisted_only",
      ref,
      runtimeId: null,
      reason: "runtime missing",
      pendingApprovals: [],
      pendingQuestions: [],
    });
  });
});
