import { describe, expect, test } from "bun:test";
import type { AgentSessionLiveEnvelope, AgentSessionLiveRef } from "@openducktor/contracts";
import { createUsageLimitStops, USAGE_LIMIT_RESUME_GRACE_MS } from "./usage-limit-stops";

const BASE = Date.parse("2026-11-15T00:00:00.000Z");
const RESET = BASE + 60 * 60_000;
const ref: AgentSessionLiveRef = {
  repoPath: "/repo",
  runtimeKind: "claude",
  workingDirectory: "/repo/worktree",
  externalSessionId: "session-1",
};
const eventBase = {
  externalSessionId: ref.externalSessionId,
  timestamp: new Date(BASE).toISOString(),
  sessionRef: ref,
};
const limitError = (resetsAtEpochMs: number): AgentSessionLiveEnvelope => ({
  type: "transcript_event",
  event: {
    ...eventBase,
    type: "turn_error",
    messageId: "limit-1",
    message: "Session limit reached.",
    usageLimit: { resetsAtEpochMs },
  },
});
const turnFailed: AgentSessionLiveEnvelope = {
  type: "transcript_event",
  event: {
    ...eventBase,
    type: "session_turn_finished",
    completionId: "result-1",
    messageIds: [],
    turnOutcome: "failed",
  },
};

/** A stop of an enabled tracker that waits for its root check. */
const planningStop = () => {
  const stops = createUsageLimitStops(() => {});
  stops.setEnabled(true);
  stops.observe(limitError(RESET));
  const stop = stops.observe(turnFailed);
  if (!stop) throw new Error("Expected a stop to plan.");
  return { stops, stop };
};

describe("usage-limit stops", () => {
  test("a reset update during the root check is checked when the check returns", () => {
    const { stops, stop } = planningStop();

    expect(stops.observe(limitError(BASE))).toBeNull();
    stops.planned(stop, true);

    expect(stops.entry(ref)).toBeNull();
    expect(stops.takeDue(RESET + USAGE_LIMIT_RESUME_GRACE_MS).due).toEqual([]);
  });

  test("the owner's own resume shows work without ending its stop", () => {
    const { stops, stop } = planningStop();
    stops.planned(stop, true);
    stops.takeDue(RESET + USAGE_LIMIT_RESUME_GRACE_MS);
    expect(
      stops.startResume(stop, {
        blockedOnInput: false,
        now: RESET + 60_000,
        recovery: { kind: "recovered" },
      }),
    ).toBe(true);

    stops.observe({
      type: "session_operation_updated",
      observation: { ref, kind: "continue", pending: true, nativeOutcome: "not_issued" },
    });
    stops.observe({
      type: "session_upsert",
      session: {
        ref,
        activity: "running",
        title: "Build",
        startedAt: new Date(BASE).toISOString(),
        pendingApprovals: [],
        pendingQuestions: [],
        contextUsage: null,
      },
    });

    expect(stops.entry(ref)).toMatchObject({ state: "resuming" });
    expect(stops.cancel(ref, "limit-1")).toBe(false);
  });

  test("clients see a due stop as scheduled, and no stop while the setting is off", () => {
    const { stops, stop } = planningStop();
    stops.planned(stop, true);
    stops.takeDue(RESET + USAGE_LIMIT_RESUME_GRACE_MS);
    expect(stops.entry(ref)).toMatchObject({ state: "scheduled" });

    stops.setEnabled(false);
    expect(stops.entry(ref)).toBeNull();
    stops.setEnabled(true);
    expect(stops.entry(ref)).toMatchObject({
      state: "scheduled",
      resumeAtEpochMs: RESET + USAGE_LIMIT_RESUME_GRACE_MS,
    });
  });
});
