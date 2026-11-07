import "../../test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import { AGENT_SESSION_GOAL_OBJECTIVE_MAX_LENGTH } from "@openducktor/contracts";
import { createHookHarness } from "../../test-support/react-hook-harness";
import { BLANK_GOAL_ERROR, useSessionStartGoalDraft } from "./use-session-start-goal-draft";

type Props = Parameters<typeof useSessionStartGoalDraft>[0];

const goalMode = { defaultObjective: 'Implement task T-1 "Add goals".', unavailableReason: null };

describe("useSessionStartGoalDraft", () => {
  test("starts off, fills the default text, and checks the text", async () => {
    const props: Props = { requestId: "one", open: true, goalMode };
    const harness = createHookHarness(useSessionStartGoalDraft, props);
    await harness.mount();
    try {
      expect(harness.getLatest()).toMatchObject({
        offered: true,
        enabled: false,
        value: undefined,
      });
      await harness.run((draft) => draft.setEnabled(true));
      expect(harness.getLatest()).toMatchObject({
        enabled: true,
        text: goalMode.defaultObjective,
        error: null,
        value: goalMode.defaultObjective,
      });
      await harness.run((draft) => draft.setText("  "));
      expect(harness.getLatest()).toMatchObject({ error: BLANK_GOAL_ERROR, value: undefined });
      await harness.run((draft) =>
        draft.setText("x".repeat(AGENT_SESSION_GOAL_OBJECTIVE_MAX_LENGTH + 1)),
      );
      expect(harness.getLatest().error).toContain("at most 4000 characters");
      await harness.update({ requestId: "one", open: false, goalMode });
      await harness.update({ requestId: "one", open: true, goalMode });
      expect(harness.getLatest()).toMatchObject({
        enabled: false,
        text: goalMode.defaultObjective,
        value: undefined,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("stays off with the reason when the runtime has no goals", async () => {
    const harness = createHookHarness(useSessionStartGoalDraft, {
      requestId: "one",
      open: true,
      goalMode: { ...goalMode, unavailableReason: "Goals need OpenCode 2.2.1 or later." },
    } satisfies Props);
    await harness.mount();
    try {
      await harness.run((draft) => draft.setEnabled(true));
      expect(harness.getLatest()).toMatchObject({
        enabled: false,
        unavailableReason: "Goals need OpenCode 2.2.1 or later.",
        value: undefined,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("is not offered by a launch without Goal mode", async () => {
    const harness = createHookHarness(useSessionStartGoalDraft, {
      requestId: "one",
      open: true,
      goalMode: undefined,
    } satisfies Props);
    await harness.mount();
    try {
      expect(harness.getLatest()).toMatchObject({ offered: false, enabled: false });
    } finally {
      await harness.unmount();
    }
  });
});
