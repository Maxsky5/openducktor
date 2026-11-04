import "../../test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import { createHookHarness } from "../../test-support/react-hook-harness";
import { useHumanReviewFeedbackState } from "./use-human-review-feedback";

describe("useHumanReviewFeedbackState", () => {
  test("opens Request Changes, edits its message, and closes", async () => {
    const task = createTaskCardFixture({
      id: "TASK-1",
      status: "human_review",
      availableActions: ["human_request_changes"],
    });
    const harness = createHookHarness(useHumanReviewFeedbackState, [task]);
    await harness.mount();
    try {
      await harness.run((form) => form.open("TASK-1", undefined, true));
      expect(harness.getLatest().state).toMatchObject({ taskId: "TASK-1", launch: null });
      await harness.run((form) => form.setMessage("Rework the API."));
      expect(harness.getLatest().state?.message).toBe("Rework the API.");
      await harness.run((form) => form.close());
      expect(harness.getLatest().state).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("opens the feedback launch of a task outside the task list", async () => {
    const task = createTaskCardFixture({ id: "TASK-2", status: "human_review" });
    const harness = createHookHarness(useHumanReviewFeedbackState, []);
    await harness.mount();
    try {
      await harness.run((form) => form.openForTask(task, "build_after_human_request_changes"));
      expect(harness.getLatest().state?.launch).toMatchObject({
        role: "build",
        launchActionId: "build_after_human_request_changes",
      });
    } finally {
      await harness.unmount();
    }
  });
});
