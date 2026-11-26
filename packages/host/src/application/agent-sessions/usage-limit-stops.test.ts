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

  test("ignores a Claude foreground-active pulse and background part updates until real turn work arrives", () => {
    const { stops, stop } = planningStop();
    stops.planned(stop, true);

    stops.observe({
      type: "session_upsert",
      session: {
        ref,
        activity: "running",
        foregroundTurnActive: true,
        title: "Build",
        startedAt: new Date(BASE).toISOString(),
        pendingApprovals: [],
        pendingQuestions: [],
        contextUsage: null,
      },
    });
    stops.observe({
      type: "transcript_event",
      event: {
        ...eventBase,
        type: "assistant_part",
        part: {
          kind: "subagent",
          messageId: "bg-1",
          partId: "sub-1",
          correlationKey: "call-bg-1",
          status: "completed",
        },
      },
    });
    stops.observe({
      type: "transcript_event",
      event: {
        ...eventBase,
        type: "assistant_part",
        part: {
          kind: "tool",
          messageId: "bg-2",
          partId: "tool-bg-1",
          tool: "Bash",
          toolType: "bash",
          callId: "call-bash-1",
          status: "completed",
        },
      },
    });
    stops.observe({
      type: "transcript_event",
      event: {
        ...eventBase,
        type: "session_turn_finished",
        completionId: "notif-result-1",
        messageIds: [],
        turnOutcome: "completed",
      },
    });
    stops.observe({
      type: "transcript_event",
      event: {
        ...eventBase,
        type: "session_idle",
        turnOutcome: "completed",
      },
    });

    expect(stops.entry(ref)).toMatchObject({
      state: "scheduled",
      resumeAtEpochMs: RESET + USAGE_LIMIT_RESUME_GRACE_MS,
    });

    stops.observe({
      type: "transcript_event",
      event: {
        ...eventBase,
        type: "assistant_part",
        part: {
          kind: "tool",
          messageId: "wake-reply-1",
          partId: "tool-new-1",
          tool: "Read",
          toolType: "read",
          callId: "call-read-1",
          status: "running",
        },
      },
    });

    expect(stops.entry(ref)).toBeNull();
  });

  test("defers a due Claude stop while foreground work is active and re-schedules it when idle", () => {
    const { stops, stop } = planningStop();
    stops.planned(stop, true);
    stops.observe({
      type: "session_upsert",
      session: {
        ref,
        activity: "running",
        foregroundTurnActive: true,
        title: "Build",
        startedAt: new Date(BASE).toISOString(),
        pendingApprovals: [],
        pendingQuestions: [],
        contextUsage: null,
      },
    });
    stops.takeDue(RESET + USAGE_LIMIT_RESUME_GRACE_MS);

    expect(
      stops.startResume(stop, {
        blockedOnInput: false,
        hasActiveTurn: true,
        now: RESET + USAGE_LIMIT_RESUME_GRACE_MS,
        recovery: { kind: "recovered" },
      }),
    ).toBe(false);
    expect(stops.entry(ref)).toMatchObject({
      state: "scheduled",
      resumeAtEpochMs: RESET + USAGE_LIMIT_RESUME_GRACE_MS,
    });
    expect(stops.takeDue(RESET + USAGE_LIMIT_RESUME_GRACE_MS + 1_000).due).toEqual([]);

    stops.observe({
      type: "session_upsert",
      session: {
        ref,
        activity: "idle",
        foregroundTurnActive: false,
        title: "Build",
        startedAt: new Date(BASE).toISOString(),
        pendingApprovals: [],
        pendingQuestions: [],
        contextUsage: null,
      },
    });

    const due = stops.takeDue(RESET + USAGE_LIMIT_RESUME_GRACE_MS + 1_000).due;
    expect(due).toEqual([stop]);
    expect(
      stops.startResume(stop, {
        blockedOnInput: false,
        hasActiveTurn: false,
        now: RESET + USAGE_LIMIT_RESUME_GRACE_MS + 1_000,
        recovery: { kind: "recovered" },
      }),
    ).toBe(true);
  });

  test("re-schedules immediately if a Claude wake went idle during the due-time check", () => {
    const { stops, stop } = planningStop();
    stops.planned(stop, true);
    stops.observe({
      type: "session_upsert",
      session: {
        ref,
        activity: "running",
        foregroundTurnActive: true,
        title: "Build",
        startedAt: new Date(BASE).toISOString(),
        pendingApprovals: [],
        pendingQuestions: [],
        contextUsage: null,
      },
    });
    stops.takeDue(RESET + USAGE_LIMIT_RESUME_GRACE_MS);

    // Wake finishes before startResume runs.
    stops.observe({
      type: "session_upsert",
      session: {
        ref,
        activity: "idle",
        foregroundTurnActive: false,
        title: "Build",
        startedAt: new Date(BASE).toISOString(),
        pendingApprovals: [],
        pendingQuestions: [],
        contextUsage: null,
      },
    });

    expect(
      stops.startResume(stop, {
        blockedOnInput: false,
        hasActiveTurn: true,
        now: RESET + USAGE_LIMIT_RESUME_GRACE_MS,
        recovery: { kind: "unknown" },
      }),
    ).toBe(false);
    expect(stops.takeDue(RESET + USAGE_LIMIT_RESUME_GRACE_MS).due).toEqual([stop]);
  });

  test("ignores running progress for background or tool_progress updates while cancelling on new tool calls", () => {
    const { stops, stop } = planningStop();
    stops.planned(stop, true);

    // Elapsed tool_progress heartbeat without background metadata.
    stops.observe({
      type: "transcript_event",
      event: {
        ...eventBase,
        type: "assistant_part",
        part: {
          kind: "tool",
          messageId: "turn-1",
          partId: "call-existing-1",
          tool: "Bash",
          toolType: "bash",
          callId: "call-existing-1",
          status: "running",
          metadata: { elapsedTimeSeconds: 12, durationMs: 12_000 },
        },
      },
    });
    // Background task progress update.
    stops.observe({
      type: "transcript_event",
      event: {
        ...eventBase,
        type: "assistant_part",
        part: {
          kind: "tool",
          messageId: "turn-0",
          partId: "call-restored-bg",
          tool: "Bash",
          toolType: "bash",
          callId: "call-restored-bg",
          status: "running",
          metadata: { backgroundTaskId: "task-bg-1", backgroundTaskStatus: "running" },
        },
      },
    });
    expect(stops.entry(ref)).toMatchObject({
      state: "scheduled",
      resumeAtEpochMs: RESET + USAGE_LIMIT_RESUME_GRACE_MS,
    });

    // A genuinely new tool call cancels the scheduled stop.
    stops.observe({
      type: "transcript_event",
      event: {
        ...eventBase,
        type: "assistant_part",
        part: {
          kind: "tool",
          messageId: "turn-2",
          partId: "call-new-2",
          tool: "Read",
          toolType: "read",
          callId: "call-new-2",
          status: "running",
        },
      },
    });
    expect(stops.entry(ref)).toBeNull();
  });

  test("ignores unsupported runtimes and releases per-session work state on session removal", () => {
    const stops = createUsageLimitStops(() => {});
    const opencodeRef: AgentSessionLiveRef = {
      ...ref,
      runtimeKind: "opencode",
      externalSessionId: "opencode-1",
    };

    stops.observe({
      type: "transcript_event",
      event: {
        externalSessionId: opencodeRef.externalSessionId,
        timestamp: new Date(BASE).toISOString(),
        sessionRef: opencodeRef,
        type: "assistant_part",
        part: {
          kind: "tool",
          messageId: "m-1",
          partId: "p-1",
          tool: "Bash",
          toolType: "bash",
          callId: "call-1",
          status: "running",
        },
      },
    });
    expect(stops.workCount(opencodeRef)).toBe(0);

    stops.observe({
      type: "transcript_event",
      event: {
        ...eventBase,
        type: "assistant_message",
        messageId: "m-2",
        message: "Done.",
      },
    });
    expect(stops.workCount(ref)).toBe(1);

    stops.observe({ type: "session_removed", ref });
    expect(stops.workCount(ref)).toBe(0);
  });

  test("ends a scheduled Claude stop on assistant output or a non-limit turn error", () => {
    const cases: AgentSessionLiveEnvelope[] = [
      {
        type: "transcript_event",
        event: {
          ...eventBase,
          type: "assistant_delta",
          channel: "text",
          messageId: "wake-1",
          delta: "Checking background output.",
        },
      },
      {
        type: "transcript_event",
        event: {
          ...eventBase,
          type: "assistant_message",
          messageId: "wake-2",
          message: "Done.",
        },
      },
      {
        type: "transcript_event",
        event: {
          ...eventBase,
          type: "turn_error",
          messageId: "wake-err-1",
          message: "Unexpected runtime error.",
        },
      },
    ];

    for (const envelope of cases) {
      const { stops, stop } = planningStop();
      stops.planned(stop, true);
      stops.observe(envelope);
      expect(stops.entry(ref)).toBeNull();
    }
  });
});
