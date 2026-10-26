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
      await harness.update({ requestId: "two", open: true, prompt: "Review the task." });
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
    } satisfies Props);
    await harness.mount();
    try {
      expect(harness.getLatest()).toMatchObject({ hasPrompt: false, value: undefined });
    } finally {
      await harness.unmount();
    }
  });
});
