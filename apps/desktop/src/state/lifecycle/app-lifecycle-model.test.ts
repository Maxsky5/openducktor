import { describe, expect, test } from "bun:test";
import type { RunEvent } from "@openducktor/contracts";
import { MAX_RUN_EVENTS, prependRunEvent, shouldLoadChecks } from "./app-lifecycle-model";

const runEvent = (runId: string): RunEvent => ({
  type: "run_started",
  runId,
  message: "Started",
  timestamp: "2026-02-22T08:00:00.000Z",
});

describe("app-lifecycle-model", () => {
  test("prepends events and keeps newest MAX_RUN_EVENTS", () => {
    const current = Array.from({ length: MAX_RUN_EVENTS }, (_, index) =>
      runEvent(`run-${index + 1}`),
    );
    const next = runEvent("run-new");

    const result = prependRunEvent(current, next);

    expect(result).toHaveLength(MAX_RUN_EVENTS);
    expect(result[0]?.runId).toBe("run-new");
    expect(result.at(-1)?.runId).toBe("run-499");
  });

  test("loads checks when any cache prerequisite is missing", () => {
    expect(
      shouldLoadChecks({
        hasRuntimeCheck: true,
        hasCachedBeadsCheck: true,
        hasCachedRepoOpencodeHealth: true,
      }),
    ).toBe(false);

    expect(
      shouldLoadChecks({
        hasRuntimeCheck: false,
        hasCachedBeadsCheck: true,
        hasCachedRepoOpencodeHealth: true,
      }),
    ).toBe(true);

    expect(
      shouldLoadChecks({
        hasRuntimeCheck: true,
        hasCachedBeadsCheck: false,
        hasCachedRepoOpencodeHealth: true,
      }),
    ).toBe(true);
  });
});
