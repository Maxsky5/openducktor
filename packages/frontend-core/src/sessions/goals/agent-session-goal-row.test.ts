import { describe, expect, test } from "bun:test";
import { buildAgentSessionGoalRow, WAITING_FOR_MESSAGE_DETAIL } from "./agent-session-goal-row";

describe("buildAgentSessionGoalRow", () => {
  test("shows no row without a goal", () => {
    expect(buildAgentSessionGoalRow(undefined, true)).toBeNull();
  });

  test.each([
    { status: "active", label: "Active", actions: ["pause", "clear"] },
    { status: "paused", label: "Paused", actions: ["resume", "clear"] },
    { status: "blocked", label: "Blocked", actions: ["resume", "clear"] },
    { status: "limit_reached", label: "Limit reached", actions: ["resume", "clear"] },
    { status: "complete", label: "Complete", actions: ["clear"] },
  ] as const)("labels $status and offers $actions", ({ status, label, actions }) => {
    expect(buildAgentSessionGoalRow({ objective: "Ship", status }, true)).toMatchObject({
      statusLabel: label,
      actions,
      detail: null,
    });
  });

  test("offers only Clear where the runtime cannot pause", () => {
    expect(
      buildAgentSessionGoalRow({ objective: "Ship", status: "active" }, false)?.actions,
    ).toEqual(["clear"]);
    expect(buildAgentSessionGoalRow({ objective: "Ship", status: "ended" }, false)).toMatchObject({
      statusLabel: "Goal ended",
      actions: ["clear"],
    });
  });

  test("shows the runtime reason and how a waiting goal continues", () => {
    expect(
      buildAgentSessionGoalRow(
        { objective: "Ship", status: "paused", reason: "Stopped by the user" },
        true,
      )?.detail,
    ).toBe("Stopped by the user");
    expect(
      buildAgentSessionGoalRow({ objective: "Ship", status: "waiting_for_message" }, false),
    ).toMatchObject({
      statusLabel: "Waiting for your message",
      detail: WAITING_FOR_MESSAGE_DETAIL,
    });
  });
});
