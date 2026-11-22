import { describe, expect, test } from "bun:test";
import type { UsageIndexProgress } from "@openducktor/contracts";
import { carryProgress, shownProgress } from "./use-usage-progress";

type Runtime = UsageIndexProgress["runtimes"][number];

const runtime = (
  name: Runtime["runtime"],
  progress: number,
  done: number,
  total: number | null,
): Runtime => ({ runtime: name, progress, done: progress === 1, sessions: { done, total } });

const event = (startedAt: string, runtimes: Runtime[]): UsageIndexProgress => ({
  phase: "reading",
  summarized: 0,
  startedAt,
  runtimes,
});

describe("usage progress across reads", () => {
  test("continues from what a canceled read finished when the user picks another range", () => {
    // The first read finished Claude Code and OpenCode, and half of Codex, when the user chose
    // All time. The next read parses only the Codex rollouts that the first read did not start.
    let carried = carryProgress(
      null,
      event("2026-11-22T10:00:00.000Z", [
        runtime("claude", 1, 223, 223),
        runtime("codex", 0.5, 300, 2_752),
        runtime("opencode", 1, 2_599, 2_599),
      ]),
    );
    carried = carryProgress(
      carried,
      event("2026-11-22T10:00:30.000Z", [runtime("codex", 0.25, 100, 2_452)]),
    );
    expect(shownProgress(carried).runtimes).toEqual([
      { runtime: "codex", progress: 0.625, done: false, sessions: { done: 400, total: 2_752 } },
      { runtime: "claude", progress: 1, done: true, sessions: { done: 223, total: 223 } },
      { runtime: "opencode", progress: 1, done: true, sessions: { done: 2_599, total: 2_599 } },
    ]);
  });

  test("keeps a runtime done when a later read adds what changed during the first one", () => {
    let carried = carryProgress(
      null,
      event("2026-11-22T10:00:00.000Z", [runtime("opencode", 1, 2_599, 2_599)]),
    );
    carried = carryProgress(
      carried,
      event("2026-11-22T10:01:00.000Z", [runtime("opencode", 0.5, 0, 0)]),
    );
    expect(shownProgress(carried).runtimes).toEqual([
      { runtime: "opencode", progress: 1, done: true, sessions: { done: 2_599, total: 2_599 } },
    ]);
  });

  test("shows a single read as it is", () => {
    const only = event("2026-11-22T10:00:00.000Z", [runtime("claude", 0.5, 2, 4)]);
    const carried = carryProgress(carryProgress(null, only), only);
    expect(shownProgress(carried)).toEqual(only);
  });
});
