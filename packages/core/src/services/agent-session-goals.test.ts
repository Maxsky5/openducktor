import { describe, expect, test } from "bun:test";
import {
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
} from "@openducktor/contracts";
import {
  goalCommandBlockedReason,
  goalCommandStartsWork,
  goalDrivesWork,
  resolveRuntimeGoalAvailability,
} from "./agent-session-goals";

describe("resolveRuntimeGoalAvailability", () => {
  test("accepts the minimum version and later", () => {
    expect(resolveRuntimeGoalAvailability(OPENCODE_RUNTIME_DESCRIPTOR, "2.2.1")).toEqual({
      available: true,
    });
    expect(resolveRuntimeGoalAvailability(CODEX_RUNTIME_DESCRIPTOR, "codex-cli 0.170.2")).toEqual({
      available: true,
    });
  });

  test("names the update for an older runtime", () => {
    expect(resolveRuntimeGoalAvailability(OPENCODE_RUNTIME_DESCRIPTOR, "2.1.9")).toEqual({
      available: false,
      reason: "Goals need OpenCode 2.2.1 or later. Run `opencode upgrade`.",
    });
  });

  test("refuses an unreadable version", () => {
    expect(resolveRuntimeGoalAvailability(CLAUDE_RUNTIME_DESCRIPTOR, null)).toEqual({
      available: false,
      reason:
        "OpenDucktor cannot read the Claude version. Goals need Claude 2.1.306 or later. Run `claude update`.",
    });
  });

  test("refuses a runtime without goals", () => {
    const descriptor = {
      ...CODEX_RUNTIME_DESCRIPTOR,
      capabilities: {
        ...CODEX_RUNTIME_DESCRIPTOR.capabilities,
        goals: { minimumRuntimeVersion: null, supportsPauseResume: false },
      },
    };
    expect(resolveRuntimeGoalAvailability(descriptor, "1.0.0")).toEqual({
      available: false,
      reason: "Codex has no goals.",
    });
  });
});

describe("goalCommandBlockedReason", () => {
  test("refuses pause and resume where the runtime cannot pause", () => {
    expect(goalCommandBlockedReason({ kind: "pause" }, CLAUDE_RUNTIME_DESCRIPTOR, "2.1.318")).toBe(
      "Claude cannot pause a goal.",
    );
    expect(goalCommandBlockedReason({ kind: "resume" }, CLAUDE_RUNTIME_DESCRIPTOR, "2.1.318")).toBe(
      "Claude cannot resume a goal.",
    );
    expect(
      goalCommandBlockedReason({ kind: "clear" }, CLAUDE_RUNTIME_DESCRIPTOR, "2.1.318"),
    ).toBeNull();
    expect(goalCommandBlockedReason({ kind: "pause" }, CODEX_RUNTIME_DESCRIPTOR, "0.166.0")).toBe(
      null,
    );
  });

  test("refuses every command where goals are unavailable", () => {
    expect(goalCommandBlockedReason({ kind: "clear" }, OPENCODE_RUNTIME_DESCRIPTOR, "2.0.32")).toBe(
      "Goals need OpenCode 2.2.1 or later. Run `opencode upgrade`.",
    );
  });
});

test("goalCommandStartsWork is true only for set and resume", () => {
  expect(goalCommandStartsWork({ kind: "set", objective: "Ship" })).toBe(true);
  expect(goalCommandStartsWork({ kind: "resume" })).toBe(true);
  expect(goalCommandStartsWork({ kind: "pause" })).toBe(false);
  expect(goalCommandStartsWork({ kind: "clear" })).toBe(false);
});

test("only an active goal of a working session drives the work", () => {
  expect(goalDrivesWork({ status: "active" }, true)).toBe(true);
  expect(goalDrivesWork({ status: "active" }, false)).toBe(false);
  expect(goalDrivesWork({ status: "paused" }, true)).toBe(false);
  expect(goalDrivesWork(null, true)).toBe(false);
});
