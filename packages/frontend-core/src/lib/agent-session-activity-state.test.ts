import { describe, expect, test } from "bun:test";
import {
  compareActiveAgentSessionActivityState,
  formatAgentSessionActivityStateLabel,
  getAgentSessionActivityState,
  getAgentSessionActivityStateFromSession,
  isAgentSessionActivityActive,
  isAgentSessionActivityWorking,
  isAgentSessionWaitingOnBackgroundState,
} from "./agent-session-activity-state";

describe("agent-session-activity-state", () => {
  test("classifies pending input before raw status", () => {
    expect(getAgentSessionActivityState({ status: "running", hasPendingInput: true })).toBe(
      "waiting_input",
    );
    expect(getAgentSessionActivityState({ status: "idle", hasPendingInput: true })).toBe(
      "waiting_input",
    );
  });

  test("classifies working and terminal statuses without pending input", () => {
    expect(getAgentSessionActivityState({ status: "starting", hasPendingInput: false })).toBe(
      "starting",
    );
    expect(getAgentSessionActivityState({ status: "running", hasPendingInput: false })).toBe(
      "running",
    );
    expect(getAgentSessionActivityState({ status: "error", hasPendingInput: false })).toBe("error");
    expect(getAgentSessionActivityState({ status: "stopped", hasPendingInput: false })).toBe(
      "stopped",
    );
    expect(getAgentSessionActivityState({ status: "idle", hasPendingInput: false })).toBe("idle");
  });

  test("keeps a running session with no reply Running, in the Background style", () => {
    const session = {
      status: "running" as const,
      foregroundTurnActive: false,
      backgroundTasks: [
        {
          taskId: "shell-1",
          kind: "command" as const,
          title: "bun run dev",
          stop: { allowed: true as const },
        },
      ],
      pendingApprovals: [],
      pendingQuestions: [],
    };

    expect(getAgentSessionActivityStateFromSession(session)).toBe("running");
    expect(isAgentSessionWaitingOnBackgroundState(session)).toBe(true);
    // A message that the user just sent is a reply, so the session loses the Background style.
    expect(
      isAgentSessionWaitingOnBackgroundState({ ...session, pendingUserMessageStartedAt: 1 }),
    ).toBe(false);
    expect(isAgentSessionWaitingOnBackgroundState({ ...session, foregroundTurnActive: true })).toBe(
      false,
    );
    // Pending input wins over the Background style.
    const asking = { ...session, pendingQuestions: [{ requestId: "q", questions: [] }] };
    expect(getAgentSessionActivityStateFromSession(asking)).toBe("waiting_input");
    expect(isAgentSessionWaitingOnBackgroundState(asking)).toBe(false);
  });

  test("publishes explicit working and active predicates", () => {
    expect(isAgentSessionActivityWorking("starting")).toBe(true);
    expect(isAgentSessionActivityWorking("running")).toBe(true);
    expect(isAgentSessionActivityWorking("waiting_input")).toBe(false);
    expect(isAgentSessionActivityActive("waiting_input")).toBe(true);
    expect(isAgentSessionActivityActive("starting")).toBe(true);
    expect(isAgentSessionActivityActive("running")).toBe(true);
    expect(isAgentSessionActivityActive("idle")).toBe(false);
    expect(isAgentSessionActivityActive("running", "Status read failed")).toBe(false);
  });

  test("publishes the canonical active-session priority", () => {
    expect(compareActiveAgentSessionActivityState("waiting_input", "running")).toBeLessThan(0);
    expect(compareActiveAgentSessionActivityState("running", "starting")).toBeLessThan(0);
    expect(compareActiveAgentSessionActivityState("starting", "starting")).toBe(0);
  });

  test("formats activity labels from the canonical vocabulary", () => {
    expect(formatAgentSessionActivityStateLabel("starting")).toBe("starting");
    expect(formatAgentSessionActivityStateLabel("waiting_input")).toBe("waiting input");
  });
});
