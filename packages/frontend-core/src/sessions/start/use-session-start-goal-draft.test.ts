import "../../test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import { AGENT_SESSION_GOAL_OBJECTIVE_MAX_LENGTH } from "@openducktor/contracts";
import { createHookHarness } from "../../test-support/react-hook-harness";
import type { SessionStartGoalMode } from "./session-start-modal-model";
import { BLANK_GOAL_ERROR, useSessionStartGoalDraft } from "./use-session-start-goal-draft";

type Props = Parameters<typeof useSessionStartGoalDraft>[0];

const goalMode: SessionStartGoalMode = {
  defaultObjective: 'Implement task T-1 "Add goals".',
  unavailableReason: null,
  generation: { kind: "unavailable", reason: "Set a default model." },
};

const deferred = () => {
  let resolve: (text: string) => void = () => {};
  let reject: (cause: Error) => void = () => {};
  const promise = new Promise<string>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

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

  test("replaces the goal text with the generated goal, and shows a failure", async () => {
    const answers = [deferred(), deferred()];
    let call = 0;
    const props: Props = {
      requestId: "one",
      open: true,
      goalMode: {
        ...goalMode,
        generation: { kind: "available", run: () => answers[call++]!.promise },
      },
    };
    const harness = createHookHarness(useSessionStartGoalDraft, props);
    await harness.mount();
    try {
      await harness.run((draft) => draft.setEnabled(true));
      expect(harness.getLatest().generation.unavailableReason).toBeNull();
      await harness.run((draft) => draft.generation.start());
      expect(harness.getLatest().generation.running).toBe(true);
      await harness.run(async () => answers[0]!.resolve("Task T-1 is done when tests pass."));
      expect(harness.getLatest()).toMatchObject({
        text: "Task T-1 is done when tests pass.",
        generation: { running: false, error: null },
      });

      await harness.run((draft) => draft.generation.start());
      await harness.run(async () => answers[1]!.reject(new Error("Claude is offline.")));
      expect(harness.getLatest()).toMatchObject({
        text: "Task T-1 is done when tests pass.",
        generation: { running: false, error: "Claude is offline." },
      });
    } finally {
      await harness.unmount();
    }
  });

  test("drops a generated goal that arrives after the form reopened", async () => {
    const answer = deferred();
    const props: Props = {
      requestId: "one",
      open: true,
      goalMode: { ...goalMode, generation: { kind: "available", run: () => answer.promise } },
    };
    const harness = createHookHarness(useSessionStartGoalDraft, props);
    await harness.mount();
    try {
      await harness.run((draft) => draft.generation.start());
      await harness.update({ ...props, open: false });
      await harness.update(props);
      await harness.run(async () => answer.resolve("Late goal."));
      expect(harness.getLatest()).toMatchObject({
        text: goalMode.defaultObjective,
        generation: { running: false },
      });
    } finally {
      await harness.unmount();
    }
  });
});
