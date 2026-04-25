import { describe, expect, test } from "bun:test";
import { DismissableLayer, DismissableLayerBranch } from "@radix-ui/react-dismissable-layer";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

function BranchDismissHarness() {
  const [open, setOpen] = useState(true);

  return (
    <>
      {open ? (
        <DismissableLayer onDismiss={() => setOpen(false)}>
          <div role="dialog">Overlay stays open</div>
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

  test("wraps the shared toaster in a dismissable layer branch with fixed defaults", async () => {
    const source = await Bun.file(new URL("./sonner.tsx", import.meta.url)).text();

    expect(source).toContain(
      'import { DismissableLayerBranch } from "@radix-ui/react-dismissable-layer";',
    );
    expect(source).toContain("<DismissableLayerBranch>");
    expect(source).toContain("</DismissableLayerBranch>");
    expect(source).toContain('position="bottom-right"');
    expect(source).toContain("richColors={false}");
    expect(source).toContain("closeButton");
    expect(source).toContain("expand");
    expect(source).toContain("visibleToasts={5}");
  });
});
