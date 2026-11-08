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
    [undefined, "idle", "waiting_for_message"],
    [undefined, "running", "active"],
    ["met", "running", "complete"],
    ["failed", "idle", "blocked"],
    ["stopped", "idle", "ended"],
  ] as const)("shows a goal with end %s in a %s session as %s", (end, activity, status) => {
    const goals = createClaudeGoalProjection();
    const goal: ClaudeNativeGoal = end ? { objective: "Ship", end } : { objective: "Ship" };
    goals.set("key", goal);

    expect(goals.project("key", { ...snapshot, activity }).goal).toEqual({
      objective: "Ship",
      status,
    });
  });

  test("keeps a clearing goal waiting while the clear turn runs", () => {
    const goals = createClaudeGoalProjection();
    goals.set("key", { objective: "Ship" }, true);

    expect(goals.project("key", { ...snapshot, activity: "running" }).goal).toEqual({
      objective: "Ship",
      status: "waiting_for_message",
    });
  });
});
