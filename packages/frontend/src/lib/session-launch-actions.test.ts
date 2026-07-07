import { describe, expect, test } from "bun:test";
import {
  getSessionLaunchAction,
  isLaunchStartModeAllowed,
  isSessionLaunchActionId,
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

  test("recognizes only configured launch action ids", () => {
    for (const id of sessionLaunchActionIds) {
      expect(isSessionLaunchActionId(id)).toBe(true);
    }

    expect(isSessionLaunchActionId(null)).toBe(false);
    expect(isSessionLaunchActionId("")).toBe(false);
    expect(isSessionLaunchActionId("qa_review ")).toBe(false);
    expect(isSessionLaunchActionId("unknown")).toBe(false);
  });

  test("checks allowed start modes for each launch action", () => {
    expect(isLaunchStartModeAllowed("build_implementation_start", "fresh")).toBe(true);
    expect(isLaunchStartModeAllowed("build_implementation_start", "reuse")).toBe(false);
    expect(isLaunchStartModeAllowed("build_pull_request_generation", "reuse")).toBe(true);
    expect(isLaunchStartModeAllowed("build_pull_request_generation", "fork")).toBe(true);
    expect(isLaunchStartModeAllowed("build_pull_request_generation", "fresh")).toBe(false);
  });

  test("does not reintroduce unsafe launch-action casts", async () => {
    const source = await Bun.file(new URL("./session-launch-actions.ts", import.meta.url)).text();

    expect(source).not.toContain("value as SessionLaunchActionId");
    expect(source).not.toContain("as SessionLaunchAction).allowedStartModes");
  });
});
