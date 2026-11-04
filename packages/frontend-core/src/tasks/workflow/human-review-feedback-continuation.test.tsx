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

/** Alpha with a Request Changes effect whose following launch depends on the destination state. */
const createReviewTask = () => {
  const { alpha: original, board } = createSharedBoardWorkflows();
  const definition = workflowDefinitionSchema.parse(original.definition);
  definition.events = definition.events.map((event) =>
    event.id === "alpha_revise" ? { ...event, effect: "review.request_changes" } : event,
  );
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

describe("Request Changes with a following launch", () => {
  test("starts the launch that the committed state selects and lets the host commit the change", async () => {
    const task = createReviewTask();
    const state = {
      ...createHumanReviewFeedbackState([task], task.id, undefined, true, {
        workflow: task.workflow,
        launchActionIds: ["alpha_write_start", "alpha_write_revise"],
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
        requestChangesTask: requestChanges,
        builderSessions: [],
        startRequestChangesSession: start,
      }),
    ).resolves.toEqual({ outcome: "cancelled" });
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        launchActionId: "alpha_write_revise",
        humanFeedback: "Revise the draft.",
        beforeStartAction: { action: "human_request_changes", note: "Revise the draft." },
      }),
    );
    expect(requestChanges).not.toHaveBeenCalled();
  });

  test("requests changes directly when no launch follows", async () => {
    const task = createReviewTask();
    const state = {
      ...createHumanReviewFeedbackState([task], task.id, undefined, true),
      message: "Revise the draft.",
    };
    expect(state.launch).toBeNull();
    const requestChanges = mock(async () => toWireTaskCard(task));

    await expect(
      submitHumanReviewFeedback({
        feedback: createFeedbackFake(),
        state,
        requestChangesTask: requestChanges,
        builderSessions: [],
        startRequestChangesSession: async () => {
          throw new Error("Request Changes without a launch starts no session.");
        },
      }),
    ).resolves.toEqual({ outcome: "updated" });
    expect(requestChanges).toHaveBeenCalledWith(task.id, "Revise the draft.");
  });
});
