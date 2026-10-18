import { describe, expect, test } from "bun:test";
import {
  getSessionLaunchAction,
  isLaunchStartModeAllowed,
  SESSION_LAUNCH_ACTIONS,
  sessionLaunchActionIds,
} from "./session-launch-actions";

describe("session-launch-actions", () => {
  test("keeps launch action ids aligned with action definitions", () => {
    expect(Object.keys(SESSION_LAUNCH_ACTIONS).sort()).toEqual([...sessionLaunchActionIds].sort());

    for (const id of sessionLaunchActionIds) {
      expect(getSessionLaunchAction(id).id).toBe(id);
    }
  });

  test("checks allowed start modes for each launch action", () => {
    expect(isLaunchStartModeAllowed("build_implementation_start", "fresh")).toBe(true);
    expect(isLaunchStartModeAllowed("build_implementation_start", "reuse")).toBe(false);
    expect(isLaunchStartModeAllowed("build_pull_request_generation", "reuse")).toBe(true);
    expect(isLaunchStartModeAllowed("build_pull_request_generation", "fork")).toBe(true);
    expect(isLaunchStartModeAllowed("build_pull_request_generation", "fresh")).toBe(false);
  });
});
