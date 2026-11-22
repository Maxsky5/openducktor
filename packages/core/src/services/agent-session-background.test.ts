import { describe, expect, test } from "bun:test";
import { isAgentSessionWaitingOnBackground } from "./agent-session-background";

const base = {
  activity: "running" as const,
  foregroundTurnActive: false,
  backgroundTasks: [{ taskId: "t1" }],
};

describe("isAgentSessionWaitingOnBackground", () => {
  test("holds when no reply runs and a task runs", () => {
    expect(isAgentSessionWaitingOnBackground(base)).toBe(true);
  });

  test("holds when only a task result is pending", () => {
    expect(
      isAgentSessionWaitingOnBackground({
        ...base,
        backgroundTasks: undefined,
        backgroundResultPending: true,
      }),
    ).toBe(true);
  });

  test("does not hold while a reply runs or the reply state is unknown", () => {
    expect(isAgentSessionWaitingOnBackground({ ...base, foregroundTurnActive: true })).toBe(false);
    expect(isAgentSessionWaitingOnBackground({ ...base, foregroundTurnActive: undefined })).toBe(
      false,
    );
  });

  test("does not hold while input blocks the session or the session is idle", () => {
    expect(isAgentSessionWaitingOnBackground({ ...base, activity: "waiting_for_question" })).toBe(
      false,
    );
    expect(isAgentSessionWaitingOnBackground({ ...base, activity: "idle" })).toBe(false);
  });

  test("does not hold without background work", () => {
    expect(isAgentSessionWaitingOnBackground({ ...base, backgroundTasks: [] })).toBe(false);
  });

  test("an active goal between turns keeps the session Running", () => {
    expect(isAgentSessionWaitingOnBackground({ ...base, goal: { status: "active" } })).toBe(false);
    expect(isAgentSessionWaitingOnBackground({ ...base, goal: { status: "paused" } })).toBe(true);
  });

  test("an unavailable status takes precedence", () => {
    expect(
      isAgentSessionWaitingOnBackground({ ...base, statusUnavailableReason: "Status read failed" }),
    ).toBe(false);
  });
});
