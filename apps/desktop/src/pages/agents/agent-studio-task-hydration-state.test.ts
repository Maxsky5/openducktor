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
        runtimeEndpoint: "http://127.0.0.1:4444",
      },
      historyHydrationState: "failed",
      sessionNeedsHydration: true,
      agentStudioReadinessState: "checking",
      waitingRecoveryKey: null,
      postReadyFailureRecoveryKey: null,
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
        runtimeEndpoint: "",
      },
      historyHydrationState: "not_requested",
      sessionNeedsHydration: true,
      agentStudioReadinessState: "ready",
      waitingRecoveryKey: null,
      postReadyFailureRecoveryKey: null,
    });

    expect(decision.shouldWaitForSessionRuntime).toBe(true);
    expect(decision.isWaitingForRuntimeReadiness).toBe(true);
    expect(decision.shouldHydrateSessionHistory).toBe(false);
  });

  test("hydrates a remembered waiting session once readiness is restored", () => {
    const decision = getAgentStudioTaskHydrationDecision({
      activeRepo: "/repo-a",
      activeTaskId: "task-1",
      activeSession: {
        sessionId: "session-1",
        role: "planner",
        runId: null,
        runtimeId: null,
        runtimeEndpoint: "http://127.0.0.1:4444",
      },
      historyHydrationState: "failed",
      sessionNeedsHydration: true,
      agentStudioReadinessState: "ready",
      waitingRecoveryKey: "/repo-a::task-1::session-1",
      postReadyFailureRecoveryKey: null,
    });

    expect(decision.isRecoveringWaitingSession).toBe(true);
    expect(decision.shouldHydrateSessionHistory).toBe(true);
  });

  test("blocks automatic recovery after a sticky post-ready failure", () => {
    const decision = getAgentStudioTaskHydrationDecision({
      activeRepo: "/repo-a",
      activeTaskId: "task-1",
      activeSession: {
        sessionId: "session-1",
        role: "planner",
        runId: null,
        runtimeId: null,
        runtimeEndpoint: "http://127.0.0.1:4444",
      },
      historyHydrationState: "failed",
      sessionNeedsHydration: true,
      agentStudioReadinessState: "ready",
      waitingRecoveryKey: "/repo-a::task-1::session-1",
      postReadyFailureRecoveryKey: "/repo-a::task-1::session-1",
    });

    expect(decision.blockedFromAutomaticRecovery).toBe(true);
    expect(decision.isWaitingForRuntimeReadiness).toBe(false);
    expect(decision.shouldHydrateSessionHistory).toBe(false);
  });
});
