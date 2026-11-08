import "../../test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import { createHookHarness } from "../../test-support/react-hook-harness";
import { useSessionStartKickoffDraft } from "./use-session-start-kickoff-draft";

type Props = Parameters<typeof useSessionStartKickoffDraft>[0];

describe("useSessionStartKickoffDraft", () => {
  test("sends the resolved prompt until the user customizes it", async () => {
    const harness = createHookHarness(useSessionStartKickoffDraft, {
      requestId: "one",
      open: true,
      prompt: "Build the task.",
      replacedByGoal: false,
    } satisfies Props);
    await harness.mount();
    try {
      expect(harness.getLatest()).toMatchObject({
        hasPrompt: true,
        enabled: false,
        value: "Build the task.",
      });
      await harness.run((draft) => draft.setEnabled(true));
      expect(harness.getLatest()).toMatchObject({ enabled: true, text: "Build the task." });
      await harness.run((draft) => draft.setText("   "));
      expect(harness.getLatest()).toMatchObject({ invalid: true, value: "   " });
      await harness.update({
        requestId: "two",
        open: true,
        prompt: "Review the task.",
        replacedByGoal: false,
      });
      expect(harness.getLatest()).toMatchObject({
        enabled: false,
        invalid: false,
        value: "Review the task.",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("has no value when the launch has no prompt", async () => {
    const harness = createHookHarness(useSessionStartKickoffDraft, {
      requestId: "one",
      open: true,
      prompt: " \n ",
      replacedByGoal: false,
    } satisfies Props);
    await harness.mount();
    try {
      expect(harness.getLatest()).toMatchObject({ hasPrompt: false, value: undefined });
    } finally {
      await harness.unmount();
    }
  });

  test("Goal mode replaces the prompt and keeps the custom text for later", async () => {
    const props: Props = {
      requestId: "one",
      open: true,
      prompt: "Build the task.",
      replacedByGoal: false,
    };
    const harness = createHookHarness(useSessionStartKickoffDraft, props);
    await harness.mount();
    try {
      await harness.run((draft) => draft.setEnabled(true));
      await harness.run((draft) => draft.setText(" "));
      await harness.update({ ...props, replacedByGoal: true });
      expect(harness.getLatest()).toMatchObject({
        hasPrompt: false,
        invalid: false,
        value: undefined,
      });
      await harness.update(props);
      expect(harness.getLatest()).toMatchObject({ enabled: true, text: " ", invalid: true });
    } finally {
      await harness.unmount();
    }
  });
});
