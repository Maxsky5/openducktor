import { describe, expect, test } from "bun:test";
import { resolveWorkspaceBoard } from "@openducktor/workflows";
import {
  createReviewTaskWorkflow,
  createWorkflowTaskCardFixture,
} from "@openducktor/workflows/test-support";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import {
  createHumanReviewFeedbackState,
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

  test("commits the event of the available event action that starts the launch", () => {
    const state = launchState(["human_request_changes", "human_approve"]);
    expect(state.eventId).toBe("human-request-changes");
    // The dialog takes the name of the action that opened it.
    expect(state.confirmLabel).toBe("Request Changes");
    expect(state.launch?.launchActionId).toBe("build_after_human_request_changes");
  });

  test("starts only the launch when no available event action starts it", () => {
    const state = launchState(["human_approve"]);
    expect(state.eventId).toBeNull();
    expect(state.launch?.launchActionId).toBe("build_after_human_request_changes");
  });
});

describe("createHumanReviewFeedbackState for an event", () => {
  test("selects the following launch of a custom feedback event", () => {
    const workflow = createReviewTaskWorkflow();
    const board = resolveWorkspaceBoard([{ workflow, latest: true }]);
    const task = createWorkflowTaskCardFixture(workflow, board, { status: "approval" });
    const state = createHumanReviewFeedbackState([task], task.id, {
      kind: "event",
      eventId: "request-rewrite",
      continuation: { workflow: task.workflow, launchActionIds: ["write_feedback"] },
    });
    expect(state.eventId).toBe("request-rewrite");
    expect(state.confirmLabel).toBe("Request rewrite");
    expect(state.launch).toEqual({
      role: "writer",
      roleLabel: "Writer",
      launchActionId: "write_feedback",
      postStartAction: "kickoff",
    });
  });
});
