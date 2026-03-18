import { describe, expect, test } from "bun:test";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioSessionStartRequest } from "./use-agent-studio-session-start-request";

enableReactActEnvironment();

const createHookHarness = () =>
  createSharedHookHarness(useAgentStudioSessionStartRequest, undefined);

const createRequest = () => ({
  taskId: "task-1",
  role: "build" as const,
  scenario: "build_implementation_start" as const,
  startMode: "fresh" as const,
  reason: "scenario_kickoff" as const,
  selectedModel: null,
});

describe("useAgentStudioSessionStartRequest", () => {
  test("stores pending request and resolves it on confirm", async () => {
    const harness = createHookHarness();

    try {
      await harness.mount();

      let decision: unknown;
      await harness.run((state) => {
        void state.requestNewSessionStart(createRequest()).then((result) => {
          decision = result;
        });
      });

      expect(harness.getLatest().pendingSessionStartRequest?.taskId).toBe("task-1");
      expect(harness.getLatest().pendingSessionStartRequest?.requestId).toBe("session-start-0");

      await harness.run((state) => {
        state.resolvePendingSessionStart("session-start-0", { selectedModel: null });
      });

      await harness.waitFor(() => decision !== undefined);
      expect(decision).toEqual({ selectedModel: null });
      expect(harness.getLatest().pendingSessionStartRequest).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("cancels previous pending request when a new request arrives", async () => {
    const harness = createHookHarness();

    try {
      await harness.mount();

      const firstRequest = createRequest();
      const secondRequest = { ...createRequest(), taskId: "task-2" };
      let firstDecision: unknown;

      await harness.run((state) => {
        void state.requestNewSessionStart(firstRequest).then((result) => {
          firstDecision = result;
        });
      });

      await harness.run((state) => {
        void state.requestNewSessionStart(secondRequest);
      });

      await harness.waitFor(() => firstDecision !== undefined);
      expect(firstDecision).toBeNull();
      expect(harness.getLatest().pendingSessionStartRequest?.taskId).toBe("task-2");
      expect(harness.getLatest().pendingSessionStartRequest?.requestId).toBe("session-start-1");
    } finally {
      await harness.unmount();
    }
  });

  test("ignores late resolution from a superseded request", async () => {
    const harness = createHookHarness();

    try {
      await harness.mount();

      let firstDecision: unknown;
      let secondDecision: unknown;

      await harness.run((state) => {
        void state.requestNewSessionStart(createRequest()).then((result) => {
          firstDecision = result;
        });
      });

      const firstRequestId = harness.getLatest().pendingSessionStartRequest?.requestId;
      if (!firstRequestId) {
        throw new Error("Expected first pending request id");
      }

      await harness.run((state) => {
        void state
          .requestNewSessionStart({ ...createRequest(), taskId: "task-2" })
          .then((result) => {
            secondDecision = result;
          });
      });

      await harness.waitFor(() => firstDecision !== undefined);
      expect(firstDecision).toBeNull();
      expect(harness.getLatest().pendingSessionStartRequest?.requestId).toBe("session-start-1");

      await harness.run((state) => {
        state.resolvePendingSessionStart(firstRequestId, { selectedModel: null });
      });

      expect(harness.getLatest().pendingSessionStartRequest?.requestId).toBe("session-start-1");
      expect(secondDecision).toBeUndefined();
    } finally {
      await harness.unmount();
    }
  });

  test("resolves pending request with null on unmount cleanup", async () => {
    const harness = createHookHarness();

    let decision: unknown;
    await harness.mount();
    await harness.run((state) => {
      void state.requestNewSessionStart(createRequest()).then((result) => {
        decision = result;
      });
    });

    await harness.unmount();

    expect(decision).toBeNull();
  });
});
