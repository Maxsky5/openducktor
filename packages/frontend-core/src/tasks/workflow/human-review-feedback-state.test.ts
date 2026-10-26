import { describe, expect, test } from "bun:test";
import { isHumanReviewFeedbackConfirmDisabled } from "./human-review-feedback-state";

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
