import { describe, expect, test } from "bun:test";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import {
  createHumanReviewFeedbackState,
  HUMAN_REVIEW_FEEDBACK_COPY,
  isHumanReviewFeedbackConfirmDisabled,
} from "./human-review-feedback-state";

describe("isHumanReviewFeedbackConfirmDisabled", () => {
  test("needs feedback text and waits while the start runs", () => {
    expect(isHumanReviewFeedbackConfirmDisabled({ message: "  ", isSubmitting: false })).toBe(true);
    expect(
      isHumanReviewFeedbackConfirmDisabled({ message: "Fix the tests", isSubmitting: true }),
    ).toBe(true);
    expect(
      isHumanReviewFeedbackConfirmDisabled({ message: "Fix the tests", isSubmitting: false }),
    ).toBe(false);
  });
});

describe("createHumanReviewFeedbackState for a launch", () => {
  const launchState = (availableActions: string[]) => {
    const task = createTaskCardFixture({ status: "human_review", availableActions });
    return createHumanReviewFeedbackState([task], task.id, {
      kind: "launch",
      launchActionId: "build_after_human_request_changes",
    });
  };

  test("commits Request Changes when the available Request Changes action starts the launch", () => {
    const state = launchState(["human_request_changes", "human_approve"]);
    expect(state.requestChanges).toBe(true);
    expect(state.confirmLabel).toBe(HUMAN_REVIEW_FEEDBACK_COPY.confirmLabel);
    expect(state.launch?.launchActionId).toBe("build_after_human_request_changes");
  });

  test("starts only the launch when no available Request Changes action starts it", () => {
    const state = launchState(["human_approve"]);
    expect(state.requestChanges).toBe(false);
    expect(state.launch?.launchActionId).toBe("build_after_human_request_changes");
  });
});
