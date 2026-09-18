import { describe, expect, test } from "bun:test";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { useSessionStartContext } from "./use-session-start-context";

const createHarness = (initialKey: string | null) =>
  createHookHarness(useSessionStartContext, initialKey);

describe("useSessionStartContext", () => {
  test("stays current while the key is unchanged and the owner stays mounted", async () => {
    const harness = createHarness("workspace-a");

    try {
      await harness.mount();
      expect(harness.getLatest()()).toBe(true);

      await harness.update("workspace-a");
      expect(harness.getLatest()()).toBe(true);
    } finally {
      await harness.unmount();
    }
  });

  test("cancels on a key change and stays canceled after the old key returns", async () => {
    const harness = createHarness("workspace-a");

    try {
      await harness.mount();
      const firstOperation = harness.getLatest();
      await harness.update("workspace-b");
      expect(firstOperation()).toBe(false);
      expect(harness.getLatest()()).toBe(true);

      await harness.update("workspace-a");
      expect(firstOperation()).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("cancels on unmount", async () => {
    const harness = createHarness("workspace-a");

    await harness.mount();
    const operation = harness.getLatest();
    await harness.unmount();
    expect(operation()).toBe(false);
  });
});
