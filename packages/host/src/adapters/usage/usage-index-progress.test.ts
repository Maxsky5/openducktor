import { describe, expect, test } from "bun:test";
import type { UsageIndexProgress } from "@openducktor/contracts";
import { createUsageProgressTracker } from "./usage-index-progress";

const job = (runtime: "claude" | "opencode", size: number) =>
  ({
    runtime,
    path: `/${runtime}/${size}`,
    format: runtime === "opencode" ? "opencode" : "jsonl",
    fingerprint: { size, modifiedAtMs: 1, fileId: "1:1" },
    previous: null,
  }) as const;

const unit = (session: string) => ({
  identity: session,
  occurredAtMs: 1,
  session,
  provider: null,
  model: null,
  project: null,
  serviceTier: null,
  tokens: null,
});

describe("createUsageProgressTracker", () => {
  test("sends the totals first, at most one update per interval, and the last update later", async () => {
    const events: UsageIndexProgress[] = [];
    const jobs = [job("claude", 100), job("claude", 50), job("opencode", 9_000)];
    const progress = createUsageProgressTracker(jobs, (event) => events.push(event));
    expect(events.map((event) => event.runtimes)).toEqual([
      [
        {
          runtime: "claude",
          sources: { done: 0, total: 2 },
          work: { done: 0, total: 150 },
          sessions: 0,
        },
        {
          runtime: "opencode",
          sources: { done: 0, total: 1 },
          work: { done: 0, total: 0 },
          sessions: 0,
        },
      ],
    ]);
    progress.finished(jobs[0]!, [unit("a"), unit("b")]);
    progress.finished(jobs[1]!, [unit("a")]);
    expect(events).toHaveLength(1);
    // The skipped update of the burst goes out at the end of the interval.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(events).toHaveLength(2);
    expect(events[1]?.runtimes[0]).toEqual({
      runtime: "claude",
      sources: { done: 2, total: 2 },
      work: { done: 150, total: 150 },
      sessions: 2,
    });
    progress.summarizing();
    expect(events.map((event) => event.phase)).toEqual(["reading", "reading", "summarizing"]);
  });
});
