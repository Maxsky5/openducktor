import { describe, expect, mock, test } from "bun:test";
import { workflowDefinitionSchema } from "@openducktor/contracts";
import { createTaskWorkflow, workflowRoleCatalog } from "@openducktor/workflows";
import {
  createSharedBoardWorkflows,
  createWorkflowTaskCardFixture,
} from "@openducktor/workflows/test-support";
import { toWireTaskCard } from "../../test-support/shared-test-fixtures";
import { createFeedbackFake } from "../../test-support/feedback-fake";
import { createHumanReviewFeedbackState } from "./human-review-feedback-state";
import type { HumanReviewFeedbackStartRequest } from "./human-review-feedback-flow";
import { submitHumanReviewFeedback } from "./human-review-feedback-flow";

/** Alpha whose revise event has a following launch that depends on the destination state. */
const createReviewTask = () => {
  const { alpha: original, board } = createSharedBoardWorkflows();
  const definition = workflowDefinitionSchema.parse(original.definition);
  for (const step of definition.steps) {
    if (step.kind !== "agent") continue;
    for (const launch of step.launchActions)
      if (launch.id === "alpha_write_revise") launch.selectWhen = { stateIn: ["alpha_work"] };
  }
  const alpha = createTaskWorkflow(
    definition,
    original.workflowTemplates,
    workflowRoleCatalog([original]),
  );
  return createWorkflowTaskCardFixture(alpha, board, { status: "shared_review" });
};

describe("A feedback event with a following launch", () => {
  test("starts the launch that the committed state selects and lets the host commit the change", async () => {
    const task = createReviewTask();
    const state = {
      ...createHumanReviewFeedbackState([task], task.id, {
        kind: "event",
        eventId: "alpha_revise",
        continuation: {
          workflow: task.workflow,
          launchActionIds: ["alpha_write_start", "alpha_write_revise"],
        },
      }),
      message: "  Revise the draft.  ",
    };
    expect(state.launch?.launchActionId).toBe("alpha_write_revise");
    const requestChanges = mock(async () => toWireTaskCard(task));
    const start = mock(async (_request: HumanReviewFeedbackStartRequest) => undefined);

    // A canceled start keeps the form, and the host never changes the task.
    await expect(
      submitHumanReviewFeedback({
        feedback: createFeedbackFake(),
        state,
        applyFeedbackEvent: requestChanges,
        builderSessions: [],
        startRequestChangesSession: start,
      }),
    ).resolves.toEqual({ outcome: "cancelled" });
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        launchActionId: "alpha_write_revise",
        humanFeedback: "Revise the draft.",
        beforeStartAction: { eventId: "alpha_revise" },
      }),
    );
    expect(requestChanges).not.toHaveBeenCalled();
  });

  test("applies the event directly when no launch follows", async () => {
    const task = createReviewTask();
    const state = {
      ...createHumanReviewFeedbackState([task], task.id, {
        kind: "event",
        eventId: "alpha_revise",
      }),
      message: "Revise the draft.",
    };
    expect(state.launch).toBeNull();
    const requestChanges = mock(async () => toWireTaskCard(task));

    await expect(
      submitHumanReviewFeedback({
        feedback: createFeedbackFake(),
        state,
        applyFeedbackEvent: requestChanges,
        builderSessions: [],
        startRequestChangesSession: async () => {
          throw new Error("An event without a launch starts no session.");
        },
      }),
    ).resolves.toEqual({ outcome: "updated" });
    expect(requestChanges).toHaveBeenCalledWith(task.id, "alpha_revise");
  });
});
