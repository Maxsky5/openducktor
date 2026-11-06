import { specPlanBuildWorkflow } from "@openducktor/workflows";

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
    expect(buildSessionStartModalTitle("spec", specPlanBuildWorkflow)).toBe("Start Spec session");
    expect(buildSessionStartModalTitle("planner", specPlanBuildWorkflow)).toBe(
      "Start Planner session",
    );
    expect(buildSessionStartModalTitle("build", specPlanBuildWorkflow)).toBe(
      "Start Builder session",
    );
    expect(buildSessionStartModalTitle("qa", specPlanBuildWorkflow)).toBe("Start QA session");
  });

  test("builds launch-action and start-mode specific descriptions", () => {
    expect(
      buildSessionStartModalDescription({
        taskWorkflow: specPlanBuildWorkflow,
        launchActionId: "spec_initial",
      }),
    ).toBe("Start a new session.");

    expect(
      buildSessionStartModalDescription({
        taskWorkflow: specPlanBuildWorkflow,
        launchActionId: "build_after_human_request_changes",
      }),
    ).toBe("Choose how to start this session.");

    expect(
      buildSessionStartModalDescription({
        taskWorkflow: specPlanBuildWorkflow,
        launchActionId: "pull_request",
      }),
    ).toBe("Choose how to start this session.");
  });
});
