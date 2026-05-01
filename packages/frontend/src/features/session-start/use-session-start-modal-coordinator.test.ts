import { describe, expect, test } from "bun:test";
import { orderStartModesForDisplay } from "./session-start-display";
import {
  buildSessionStartModalDescription,
  buildSessionStartModalTitle,
  toSessionStartPostAction,
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
    expect(buildSessionStartModalTitle("spec")).toBe("Start Spec Session");
    expect(buildSessionStartModalTitle("planner")).toBe("Start Planner Session");
    expect(buildSessionStartModalTitle("build")).toBe("Start Builder Session");
    expect(buildSessionStartModalTitle("qa")).toBe("Start QA Session");
  });

  test("builds launch-action and start-mode specific descriptions", () => {
    expect(buildSessionStartModalDescription({ launchActionId: "spec_initial" })).toBe(
      "Start a fresh session for Spec.",
    );

    expect(
      buildSessionStartModalDescription({ launchActionId: "build_after_human_request_changes" }),
    ).toBe("Choose how to start fresh or reuse an existing session for Apply Human Changes.");

    expect(
      buildSessionStartModalDescription({ launchActionId: "build_pull_request_generation" }),
    ).toBe(
      "Choose how to reuse an existing session or fork an existing session for Generate Pull Request.",
    );
  });

  test("maps session-start reasons to post actions", () => {
    expect(toSessionStartPostAction("create_session")).toBe("none");
    expect(toSessionStartPostAction("composer_send")).toBe("send_message");
    expect(toSessionStartPostAction("launch_kickoff")).toBe("kickoff");
  });
});
