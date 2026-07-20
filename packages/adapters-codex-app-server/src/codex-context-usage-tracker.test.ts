import { describe, expect, test } from "bun:test";
import { CodexContextUsageTracker } from "./codex-context-usage-tracker";

const usageNotification = (lastTotalTokens: number, totalTokens = lastTotalTokens) => ({
  method: "thread/tokenUsage/updated",
  params: {
    threadId: "thread-idle",
    tokenUsage: {
      last: { totalTokens: lastTotalTokens },
      total: { totalTokens },
      modelContextWindow: 200_000,
    },
  },
  receivedAt: "2026-07-06T12:00:00.000Z",
});

describe("CodexContextUsageTracker", () => {
  test("accepts zero current usage with a positive cumulative total", () => {
    const tracker = new CodexContextUsageTracker();
    tracker.observeNotification("runtime-live", usageNotification(42_000));
    tracker.observeNotification("runtime-live", usageNotification(0, 42_000));

    expect(tracker.latest("runtime-live", "thread-idle")).toEqual({
      totalTokens: 0,
      contextWindow: 200_000,
    });
  });

  test("accepts zero usage without a model context window", () => {
    const tracker = new CodexContextUsageTracker();
    tracker.observeNotification("runtime-live", {
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-idle",
        tokenUsage: {
          last: { totalTokens: 0 },
          total: { totalTokens: 0 },
        },
      },
      receivedAt: "2026-07-06T12:00:00.000Z",
    });

    expect(tracker.latest("runtime-live", "thread-idle")).toEqual({ totalTokens: 0 });
  });

  test("shares concurrent and synchronously reentrant loads", async () => {
    const tracker = new CodexContextUsageTracker();
    let nestedLoad: Promise<unknown> | null = null;
    let resumeAttempts = 0;
    const firstLoad = tracker.load("runtime-live", "thread-idle", async () => {
      resumeAttempts += 1;
      nestedLoad = tracker.load("runtime-live", "thread-idle", async () => {
        resumeAttempts += 1;
      });
    });
    const secondLoad = tracker.load("runtime-live", "thread-idle", async () => {
      resumeAttempts += 1;
    });

    await expect(Promise.all([firstLoad, secondLoad])).resolves.toEqual([null, null]);
    await expect(nestedLoad).resolves.toBeNull();
    expect(resumeAttempts).toBe(1);
  });

  test("clears a failed load so an explicit later load retries", async () => {
    const tracker = new CodexContextUsageTracker();
    let resumeAttempts = 0;

    await expect(
      tracker.load("runtime-live", "thread-idle", async () => {
        resumeAttempts += 1;
        throw new Error("resume unavailable");
      }),
    ).rejects.toThrow("resume unavailable");
    await expect(
      tracker.load("runtime-live", "thread-idle", async () => {
        resumeAttempts += 1;
      }),
    ).resolves.toBeNull();

    expect(resumeAttempts).toBe(2);
  });
});
