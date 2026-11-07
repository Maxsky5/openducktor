import { enableReactActEnvironment } from "@openducktor/frontend-core/test-support/react-act-environment";
import { describe, expect, test } from "bun:test";
import { DismissableLayer, DismissableLayerBranch } from "@radix-ui/react-dismissable-layer";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { toast } from "sonner";
import { Toaster } from "./sonner";

enableReactActEnvironment();

function BranchDismissHarness() {
  const [open, setOpen] = useState(true);

  return (
    <>
      {open ? (
        <DismissableLayer onDismiss={() => setOpen(false)}>
          <dialog open>Overlay stays open</dialog>
        </DismissableLayer>
      ) : null}
      <DismissableLayerBranch>
        <button type="button">Close toast</button>
      </DismissableLayerBranch>
    </>
  );
}

async function waitForDismissableLayerEffects() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Toaster", () => {
  test("dismissable layer branches keep pointer interactions from dismissing overlays", async () => {
    render(<BranchDismissHarness />);

    await waitForDismissableLayerEffects();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Close toast" }));

    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  test("marks each toast box as a page occluder", async () => {
    const view = render(<Toaster />);
    let id: string | number | undefined;
    try {
      act(() => {
        id = toast("Saved");
      });
      const element = await waitFor(() => {
        const found = document.querySelector("[data-sonner-toast]");
        if (!(found instanceof HTMLElement)) throw new Error("The toast is missing.");
        return found;
      });
      await waitFor(() => expect(element.getAttribute("data-page-occluder")).toBe(""));
    } finally {
      if (id !== undefined) act(() => toast.dismiss(id));
      view.unmount();
    }
  });
});
