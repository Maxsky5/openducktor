import { describe, expect, test } from "bun:test";
import { orderStartModesForDisplay } from "./session-start-display";
import {
  buildSessionStartModalDescription,
  buildSessionStartModalTitle,
} from "./use-session-start-modal-coordinator";

describe("use-session-start-modal-coordinator", () => {
  test("orders start modes for display consistently", () => {
    expect(orderStartModesForDisplay(["fork", "reuse"])).toEqual(["reuse", "fork"]);
    expect(orderStartModesForDisplay(["fork", "fresh", "reuse"])).toEqual([
      "fresh",
      "reuse",
      "fork",
    ]);
  });

  test("builds role-specific session start titles", () => {
    expect(buildSessionStartModalTitle("spec")).toBe("Start Spec session");
    expect(buildSessionStartModalTitle("planner")).toBe("Start Planner session");
    expect(buildSessionStartModalTitle("build")).toBe("Start Builder session");
    expect(buildSessionStartModalTitle("qa")).toBe("Start QA session");
  });

  test("builds launch-action and start-mode specific descriptions", () => {
    expect(buildSessionStartModalDescription({ launchActionId: "spec_initial" })).toBe(
      "Start a new session.",
    );

    expect(
      buildSessionStartModalDescription({ launchActionId: "build_after_human_request_changes" }),
    ).toBe("Choose how to start this session.");

    expect(
      buildSessionStartModalDescription({ launchActionId: "build_pull_request_generation" }),
    ).toBe("Choose how to start this session.");
  });
});
