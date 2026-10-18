import { describe, expect, test } from "bun:test";
import { enableReactActEnvironment } from "@openducktor/frontend-core/test-support/react-act-environment";
import { createHookHarness as createSharedHookHarness } from "@openducktor/frontend-core/test-support/react-hook-harness";
import { useAsyncActivityTracker } from "./use-async-activity-tracker";

enableReactActEnvironment();

const createHookHarness = () => createSharedHookHarness(useAsyncActivityTracker, undefined);

describe("useAsyncActivityTracker", () => {
  test("tracks activity across multiple context keys until the handle finishes", async () => {
    const harness = createHookHarness();

    await harness.mount();

    let handle: ReturnType<ReturnType<typeof useAsyncActivityTracker>["begin"]> | null = null;
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

  test("keeps a key in flight until the last of its handles finishes", async () => {
    const harness = createHookHarness();
    await harness.mount();

    const handles: Array<ReturnType<ReturnType<typeof useAsyncActivityTracker>["begin"]>> = [];
    await harness.run((tracker) => {
      handles.push(tracker.begin("session-key"), tracker.begin("session-key"));
    });

    await harness.run(() => handles[0]?.finish());
    expect(harness.getLatest().hasInFlight("session-key")).toBe(true);
    expect(harness.getLatest().isActive("session-key")).toBe(true);

    await harness.run(() => handles[1]?.finish());
    expect(harness.getLatest().hasInFlight("session-key")).toBe(false);
    expect(harness.getLatest().isActive("session-key")).toBe(false);

    await harness.unmount();
  });
});
