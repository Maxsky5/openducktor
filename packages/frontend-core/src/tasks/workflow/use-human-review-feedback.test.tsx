import "../../test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import { createFeedbackFake } from "../../test-support/feedback-fake";
import { IsolatedQueryWrapper } from "../../test-support/isolated-query-wrapper";
import { createHookHarness } from "../../test-support/react-hook-harness";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import { useHumanReviewFeedback } from "./use-human-review-feedback";

const renderFeedback = (tasks: Parameters<typeof useHumanReviewFeedback>[0]["tasks"]) =>
  createHookHarness(
    useHumanReviewFeedback,
    {
      tasks,
      scope: { workspaceId: "workspace-1", repoPath: "/repo" },
      feedback: createFeedbackFake(),
      sessions: [],
      startSession: async () => undefined,
    },
    { wrapper: IsolatedQueryWrapper },
  );

describe("useHumanReviewFeedback", () => {
  test("opens the feedback of an event, edits its message, and closes", async () => {
    const task = createTaskCardFixture({
      id: "TASK-1",
      status: "human_review",
      availableActions: ["human_request_changes"],
    });
    const harness = renderFeedback([task]);
    await harness.mount();
    try {
      await harness.run((form) =>
        form.open("TASK-1", { kind: "event", eventId: "human-request-changes" }),
      );
      expect(harness.getLatest().modal).toMatchObject({ taskId: "TASK-1", roleLabel: null });
      await harness.run((form) => form.modal?.onMessageChange("Rework the API."));
      expect(harness.getLatest().modal?.message).toBe("Rework the API.");
      await harness.run((form) => form.modal?.onOpenChange(false));
      expect(harness.getLatest().modal).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("opens the feedback launch of a task outside the task list", async () => {
    const task = createTaskCardFixture({ id: "TASK-2", status: "human_review" });
    const harness = renderFeedback([]);
    await harness.mount();
    try {
      await harness.run((form) => form.openForTask(task, "build_after_human_request_changes"));
      expect(harness.getLatest().modal?.roleLabel).toBe("Builder");
    } finally {
      await harness.unmount();
    }
  });
});
