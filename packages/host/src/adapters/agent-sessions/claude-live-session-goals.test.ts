import { describe, expect, test } from "bun:test";
import type { AgentSessionLiveSnapshot } from "@openducktor/contracts";
import type { ClaudeNativeGoal } from "../claude/claude-agent-sdk-types";
import { createClaudeGoalProjection } from "./claude-live-session-goals";

const snapshot: AgentSessionLiveSnapshot = {
  ref: {
    repoPath: "/repo",
    runtimeKind: "claude",
    workingDirectory: "/repo",
    externalSessionId: "session-1",
  },
  activity: "idle",
  title: "Chat",
  startedAt: "2026-11-08T10:00:00.000Z",
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
};

describe("createClaudeGoalProjection", () => {
  test.each([
    [undefined, "ended"],
    ["met", "complete"],
    ["failed", "blocked"],
  ] as const)("shows an ended goal with outcome %s as %s", (outcome, status) => {
    const goals = createClaudeGoalProjection();
    const goal: ClaudeNativeGoal = outcome
      ? { objective: "Ship", ended: true, outcome }
      : { objective: "Ship", ended: true };
    goals.set("key", goal);

    expect(goals.project("key", snapshot).goal).toEqual({ objective: "Ship", status });
  });
});
