import { describe, expect, test } from "bun:test";
import { CodexRuntimeEventSubscriptions } from "./codex-runtime-events";

describe("CodexRuntimeEventSubscriptions", () => {
  test("removes a failed synchronous subscription so the runtime can retry", async () => {
    let subscribeAttempts = 0;
    const subscriptions = new CodexRuntimeEventSubscriptions(() => {
      subscribeAttempts += 1;
      if (subscribeAttempts === 1) {
        throw new Error("subscribe failed");
      }
      return () => undefined;
    });

    expect(() => subscriptions.ensure("runtime-1", () => undefined)).toThrow("subscribe failed");
    await expect(subscriptions.ensure("runtime-1", () => undefined)).resolves.toBeUndefined();
    expect(subscribeAttempts).toBe(2);
  });
});
