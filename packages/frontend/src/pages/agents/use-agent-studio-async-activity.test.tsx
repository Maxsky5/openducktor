import { describe, expect, test } from "bun:test";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioAsyncActivityTracker } from "./use-agent-studio-async-activity";

enableReactActEnvironment();

const createHookHarness = () =>
  createSharedHookHarness(useAgentStudioAsyncActivityTracker, undefined);

describe("useAgentStudioAsyncActivityTracker", () => {
  test("tracks activity across multiple context keys until the handle finishes", async () => {
    const harness = createHookHarness();

    await harness.mount();

    let handle: ReturnType<ReturnType<typeof useAgentStudioAsyncActivityTracker>["begin"]> | null =
      null;
    await harness.run((tracker) => {
      handle = tracker.begin("draft-key");
      handle.add("session-key");
    });

    expect(harness.getLatest().isActive("draft-key")).toBe(true);
    expect(harness.getLatest().isActive("session-key")).toBe(true);
    expect(harness.getLatest().hasInFlight("draft-key")).toBe(true);
    expect(harness.getLatest().hasInFlight("session-key")).toBe(true);

    await harness.run(() => {
      if (!handle) {
        throw new Error("Expected activity handle to be created");
      }
      handle.finish();
    });

    expect(harness.getLatest().isActive("draft-key")).toBe(false);
    expect(harness.getLatest().isActive("session-key")).toBe(false);
    expect(harness.getLatest().hasInFlight("draft-key")).toBe(false);
    expect(harness.getLatest().hasInFlight("session-key")).toBe(false);

    await harness.unmount();
  });
});
