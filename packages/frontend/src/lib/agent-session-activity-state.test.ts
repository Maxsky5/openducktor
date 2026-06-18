import { describe, expect, test } from "bun:test";
import {
  compareActiveAgentSessionActivityState,
  formatAgentSessionActivityStateLabel,
  getAgentSessionActivityState,
  isAgentSessionActivityActive,
  isAgentSessionActivityWorking,
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

  test("publishes explicit working and active predicates", () => {
    expect(isAgentSessionActivityWorking("starting")).toBe(true);
    expect(isAgentSessionActivityWorking("running")).toBe(true);
    expect(isAgentSessionActivityWorking("waiting_input")).toBe(false);
    expect(isAgentSessionActivityActive("waiting_input")).toBe(true);
    expect(isAgentSessionActivityActive("starting")).toBe(true);
    expect(isAgentSessionActivityActive("running")).toBe(true);
    expect(isAgentSessionActivityActive("idle")).toBe(false);
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
