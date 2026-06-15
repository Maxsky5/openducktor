import { describe, expect, test } from "bun:test";
import {
  agentSessionStatusFromActivity,
  classifyAgentSessionActivity,
  toAgentSessionRuntimeSnapshot,
  toMissingAgentSessionRuntimeSnapshot,
} from "./agent-session-runtime-snapshot";

describe("agent-session-runtime-snapshot", () => {
  test("classifies pending questions before approvals and retry status", () => {
    const classification = classifyAgentSessionActivity({
      runtimeActivity: "retrying",
      pendingApprovals: [{ requestId: "approval-1" }],
      pendingQuestions: [{ requestId: "question-1" }],
    });

    expect(classification).toBe("waiting_for_question");
    expect(agentSessionStatusFromActivity(classification)).toBe("idle");
  });

  test("classifies pending approvals before retry status", () => {
    const classification = classifyAgentSessionActivity({
      runtimeActivity: "retrying",
      pendingApprovals: [{ requestId: "approval-1" }],
      pendingQuestions: [],
    });

    expect(classification).toBe("waiting_for_permission");
    expect(agentSessionStatusFromActivity(classification)).toBe("idle");
  });

  test("classifies retry as retrying and runtime-running", () => {
    const classification = classifyAgentSessionActivity({
      runtimeActivity: "retrying",
      pendingApprovals: [],
      pendingQuestions: [],
    });

    expect(classification).toBe("retrying");
    expect(agentSessionStatusFromActivity(classification)).toBe("running");
  });

  test("classifies busy as running", () => {
    const classification = classifyAgentSessionActivity({
      runtimeActivity: "running",
      pendingApprovals: [],
      pendingQuestions: [],
    });

    expect(classification).toBe("running");
    expect(agentSessionStatusFromActivity(classification)).toBe("running");
  });

  test("classifies idle without pending input as idle", () => {
    const classification = classifyAgentSessionActivity({
      runtimeActivity: "idle",
      pendingApprovals: [],
      pendingQuestions: [],
    });

    expect(classification).toBe("idle");
    expect(agentSessionStatusFromActivity(classification)).toBe("idle");
  });

  test("builds runtime snapshot source from a runtime snapshot source", () => {
    const snapshot = toAgentSessionRuntimeSnapshot({
      ref: {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      },
      snapshot: {
        externalSessionId: "session-1",
        title: "Build session",
        workingDirectory: "/repo/worktree",
        startedAt: "2026-02-22T12:00:00.000Z",
        runtimeActivity: "running",
        pendingApprovals: [],
        pendingQuestions: [],
      },
    });

    expect(snapshot).toEqual({
      availability: "runtime",
      classification: "running",
      ref: {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      },
      title: "Build session",
      startedAt: "2026-02-22T12:00:00.000Z",
      pendingApprovals: [],
      pendingQuestions: [],
    });
  });

  test("builds missing snapshot when a runtime snapshot is absent", () => {
    const ref = {
      repoPath: "/repo",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo/worktree",
      externalSessionId: "session-1",
    };

    expect(
      toAgentSessionRuntimeSnapshot({
        ref,
        snapshot: null,
      }),
    ).toEqual({
      availability: "missing",
      classification: "missing",
      ref,
      pendingApprovals: [],
      pendingQuestions: [],
    });
  });

  test("builds missing snapshot for records without a live runtime", () => {
    const ref = {
      repoPath: "/repo",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo/worktree",
      externalSessionId: "session-1",
    };

    expect(toMissingAgentSessionRuntimeSnapshot(ref)).toEqual({
      availability: "missing",
      classification: "missing",
      ref,
      pendingApprovals: [],
      pendingQuestions: [],
    });
  });
});
