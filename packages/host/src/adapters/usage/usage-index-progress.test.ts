import { describe, expect, test } from "bun:test";
import path from "node:path";
import type { UsageIndexProgress } from "@openducktor/contracts";
import { createUsageProgressTracker } from "./usage-index-progress";

const job = (runtime: "claude" | "codex" | "opencode", file: string, size = 100) =>
  ({
    runtime,
    path: file,
    format: runtime === "opencode" ? "opencode" : "jsonl",
    fingerprint: { size, modifiedAtMs: 1, fileId: "1:1" },
    previous: null,
  }) as const;

const projects = path.join("claude", "projects", "repo");
const JOBS = [
  job("claude", path.join(projects, "s1.jsonl"), 300),
  job("claude", path.join(projects, "s1", "subagents", "agent-a.jsonl"), 100),
  job("codex", path.join("codex", "rollout-1.jsonl")),
  job("opencode", path.join("data", "opencode.db")),
];

/** A tracker whose clock moves past the interval at each read, so every update goes out. */
const track = () => {
  const events: UsageIndexProgress[] = [];
  let clock = 0;
  const tracker = createUsageProgressTracker(
    JOBS,
    (event) => events.push(event),
    () => (clock += 1_000),
  );
  const last = (runtime: string) =>
    events.at(-1)?.runtimes.find((entry) => entry.runtime === runtime);
  return { tracker, events, last };
};

describe("createUsageProgressTracker", () => {
  test("names Claude sessions from their paths and waits for the other sessions", () => {
    const { events, last } = track();
    expect(events).toHaveLength(1);
    expect(last("claude")).toEqual({
      runtime: "claude",
      progress: 0,
      done: false,
      sessions: { done: 0, total: 1 },
    });
    expect(last("codex")?.sessions).toEqual({ done: 0, total: null });
    expect(last("opencode")?.sessions).toEqual({ done: 0, total: null });
  });

  test("reads a session once all its sources are parsed, and weighs files by their bytes", () => {
    const { tracker, last } = track();
    tracker.finished(0);
    expect(last("claude")).toMatchObject({ progress: 0.75, sessions: { done: 0, total: 1 } });
    tracker.finished(1);
    expect(last("claude")).toMatchObject({
      progress: 1,
      done: true,
      sessions: { done: 1, total: 1 },
    });
    tracker.sessionOf(2, "root");
    expect(last("codex")?.sessions).toEqual({ done: 0, total: 1 });
  });

  test("takes the share and the sessions of a database from its reader", () => {
    const { tracker, events, last } = track();
    tracker.inside(3, { fraction: 0.5, sessions: { done: 2, total: 4 } });
    expect(last("opencode")).toMatchObject({ progress: 0.5, sessions: { done: 2, total: 4 } });
    tracker.finished(3);
    expect(last("opencode")).toMatchObject({
      progress: 1,
      done: true,
      sessions: { done: 4, total: 4 },
    });
    tracker.summarizing();
    expect(events.at(-1)?.phase).toBe("summarizing");
  });

  test("sends at most one update per interval, and the last update of a burst later", async () => {
    const events: UsageIndexProgress[] = [];
    const tracker = createUsageProgressTracker(JOBS, (event) => events.push(event));
    tracker.finished(0);
    tracker.finished(1);
    expect(events).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(events).toHaveLength(2);
    expect(events[1]?.runtimes[0]?.sessions).toEqual({ done: 1, total: 1 });
  });
});
