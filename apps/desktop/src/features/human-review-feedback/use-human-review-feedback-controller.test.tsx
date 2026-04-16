import { describe, expect, test } from "bun:test";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { HumanReviewFeedbackState } from "./human-review-feedback-types";
import { useHumanReviewFeedbackController } from "./use-human-review-feedback-controller";

enableReactActEnvironment();

const createState = (
  overrides: Partial<HumanReviewFeedbackState> = {},
): HumanReviewFeedbackState => ({
  taskId: "TASK-1",
  scenario: "build_after_human_request_changes",
  message: "Apply the requested changes.",
  ...overrides,
});

describe("useHumanReviewFeedbackController", () => {
  test("opens feedback with the created state", async () => {
    const harness = createHookHarness(useHumanReviewFeedbackController, {
      createState: (taskId: string) => createState({ taskId }),
    });

    await harness.mount();
    await harness.run((state) => {
      state.openHumanReviewFeedback("TASK-1");
    });

    expect(harness.getLatest().humanReviewFeedbackState).toEqual(createState());

    await harness.unmount();
  });

  test("clearHumanReviewFeedback resets the modal state", async () => {
    const harness = createHookHarness(useHumanReviewFeedbackController, {
      createState: (taskId: string) => createState({ taskId }),
    });

    await harness.mount();
    await harness.run((state) => {
      state.openHumanReviewFeedback("TASK-1");
    });
    await harness.run((state) => {
      state.clearHumanReviewFeedback();
    });

    expect(harness.getLatest().humanReviewFeedbackState).toBeNull();

    await harness.unmount();
  });

  test("setHumanReviewFeedbackState can update the current draft message", async () => {
    const harness = createHookHarness(useHumanReviewFeedbackController, {
      createState: (taskId: string) => createState({ taskId, message: "Initial draft" }),
    });

    await harness.mount();
    await harness.run((state) => {
      state.openHumanReviewFeedback("TASK-1");
    });
    await harness.run((state) => {
      state.setHumanReviewFeedbackState((current) =>
        current ? { ...current, message: "Updated draft" } : current,
      );
    });

    expect(harness.getLatest().humanReviewFeedbackState?.message).toBe("Updated draft");

    await harness.unmount();
  });
});
