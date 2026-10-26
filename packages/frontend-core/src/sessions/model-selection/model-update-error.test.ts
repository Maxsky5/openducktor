import { describe, expect, test } from "bun:test";
import { remoteError } from "@openducktor/host-client/remote";
import { createFeedbackFake } from "../../test-support/feedback-fake";
import { reportModelUpdateError } from "./model-update-error";

describe("reportModelUpdateError", () => {
  test("reports a failed model change with the host reason", () => {
    const feedback = createFeedbackFake();
    reportModelUpdateError(feedback, new Error("The model is not in the catalog."));
    expect(feedback.shown).toEqual([
      {
        kind: "error",
        message: "Failed to update model",
        options: { description: "The model is not in the catalog." },
      },
    ]);
  });

  test("reports a lost result as Result unknown with the host guidance", () => {
    const feedback = createFeedbackFake();
    reportModelUpdateError(
      feedback,
      remoteError("outcome_unknown", "The result of model update was lost.", "Read the session."),
    );
    expect(feedback.shown[0]?.message).toBe("Result unknown");
    expect(feedback.shown[0]?.options?.description).toContain("Read the session.");
  });
});
