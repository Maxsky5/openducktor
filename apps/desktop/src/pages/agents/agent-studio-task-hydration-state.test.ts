import { describe, expect, test } from "bun:test";
import { getAgentStudioTaskHydrationDecision } from "./agent-studio-task-hydration-state";

describe("getAgentStudioTaskHydrationDecision", () => {
  test("waits while page readiness is still unavailable", () => {
    const decision = getAgentStudioTaskHydrationDecision({
      activeRepo: "/repo-a",
      activeTaskId: "task-1",
      activeSession: {
        sessionId: "session-1",
        role: "planner",
        runId: null,
        runtimeId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        runtimeRecoveryState: "idle",
      },
      historyHydrationState: "failed",
      sessionNeedsHydration: true,
      agentStudioReadinessState: "checking",
    });

    expect(decision.isWaitingForRuntimeReadiness).toBe(true);
    expect(decision.shouldHydrateSessionHistory).toBe(false);
  });

  test("waits for a build session runtime attachment even after page readiness turns ready", () => {
    const decision = getAgentStudioTaskHydrationDecision({
      activeRepo: "/repo-a",
      activeTaskId: "task-1",
      activeSession: {
        sessionId: "session-1",
        role: "build",
        runId: null,
        runtimeId: null,
        runtimeRoute: null,
        runtimeRecoveryState: "idle",
      },
      historyHydrationState: "not_requested",
      sessionNeedsHydration: true,
      agentStudioReadinessState: "ready",
    });

    expect(decision.shouldWaitForSessionRuntime).toBe(true);
    expect(decision.isWaitingForRuntimeReadiness).toBe(true);
    expect(decision.shouldHydrateSessionHistory).toBe(false);
  });

  test("shows a recovering waiting session while runtime reattachment is in progress", () => {
    const decision = getAgentStudioTaskHydrationDecision({
      activeRepo: "/repo-a",
      activeTaskId: "task-1",
      activeSession: {
        sessionId: "session-1",
        role: "planner",
        runId: null,
        runtimeId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        runtimeRecoveryState: "recovering_runtime",
      },
      historyHydrationState: "not_requested",
      sessionNeedsHydration: true,
      agentStudioReadinessState: "ready",
    });

    expect(decision.isRecoveringWaitingSession).toBe(true);
    expect(decision.shouldHydrateSessionHistory).toBe(false);
  });

  test("allows recovery to retry after a session runtime recovery failure", () => {
    const decision = getAgentStudioTaskHydrationDecision({
      activeRepo: "/repo-a",
      activeTaskId: "task-1",
      activeSession: {
        sessionId: "session-1",
        role: "build",
        runId: null,
        runtimeId: null,
        runtimeRoute: null,
        runtimeRecoveryState: "failed",
      },
      historyHydrationState: "not_requested",
      sessionNeedsHydration: true,
      agentStudioReadinessState: "ready",
    });

    expect(decision.isWaitingForRuntimeReadiness).toBe(true);
    expect(decision.shouldHydrateSessionHistory).toBe(false);
  });
});
