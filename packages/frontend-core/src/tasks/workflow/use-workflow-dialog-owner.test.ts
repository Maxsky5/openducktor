import "../../test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import { useState } from "react";
import { createHookHarness } from "../../test-support/react-hook-harness";
import { useWorkflowDialogOwner } from "./use-workflow-dialog-owner";

// A workflow action that opens its dialog in the same update, as the shared dialogs do.
const useDialogWithOwner = () => {
  const [dialogOpen, setDialogOpen] = useState(false);
  return { ...useWorkflowDialogOwner(dialogOpen), setDialogOpen };
};

describe("useWorkflowDialogOwner", () => {
  test("gives the dialog that a claimed run opens to the owner until it closes", async () => {
    const harness = createHookHarness(useDialogWithOwner, undefined);
    await harness.mount();

    await harness.run((state) => {
      state.claimWorkflowDialog("sheet", () => state.setDialogOpen(true));
    });
    expect(harness.getLatest().workflowDialogOwner).toBe("sheet");

    await harness.run((state) => state.setDialogOpen(false));
    expect(harness.getLatest().workflowDialogOwner).toBeNull();

    await harness.run((state) => state.setDialogOpen(true));
    expect(harness.getLatest().workflowDialogOwner).toBeNull();
    await harness.unmount();
  });

  test("releases a claim whose run opens no dialog", async () => {
    const harness = createHookHarness(useDialogWithOwner, undefined);
    await harness.mount();

    await harness.run((state) => {
      state.claimWorkflowDialog("sheet", () => {});
    });
    await harness.run((state) => state.setDialogOpen(true));

    expect(harness.getLatest().workflowDialogOwner).toBeNull();
    await harness.unmount();
  });
});
