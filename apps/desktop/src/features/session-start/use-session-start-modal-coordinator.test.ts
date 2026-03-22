import { describe, expect, test } from "bun:test";
import {
  buildSessionStartModalDescription,
  buildSessionStartModalTitle,
  toSessionStartPostAction,
} from "./use-session-start-modal-coordinator";

describe("use-session-start-modal-coordinator", () => {
  test("builds role-specific session start titles", () => {
    expect(buildSessionStartModalTitle("spec")).toBe("Start Spec Session");
    expect(buildSessionStartModalTitle("planner")).toBe("Start Planner Session");
    expect(buildSessionStartModalTitle("build")).toBe("Start Builder Session");
    expect(buildSessionStartModalTitle("qa")).toBe("Start QA Session");
  });

  test("builds scenario and start-mode specific descriptions", () => {
    expect(
      buildSessionStartModalDescription({
        scenario: "spec_initial",
      }),
    ).toBe("Start a fresh session for Spec.");

    expect(
      buildSessionStartModalDescription({
        scenario: "build_after_human_request_changes",
      }),
    ).toBe("Choose whether to start fresh or reuse an existing session for Apply Human Changes.");
  });

  test("maps session-start reasons to post actions", () => {
    expect(toSessionStartPostAction("create_session")).toBe("none");
    expect(toSessionStartPostAction("composer_send")).toBe("send_message");
    expect(toSessionStartPostAction("scenario_kickoff")).toBe("kickoff");
  });
});
