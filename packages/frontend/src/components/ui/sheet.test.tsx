import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { finishSheetExit, withSheetAnimations } from "@/test-utils/mock-sheet-animations";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetTitle } from "./sheet";

function renderSheet(open: boolean, onOpenChange: (open: boolean) => void = () => {}) {
  return (
    <Sheet modal={false} open={open} onOpenChange={onOpenChange}>
      <SheetContent visualOverlay closeButton={null}>
        <SheetTitle>Task details</SheetTitle>
        <SheetDescription>Inspect the task.</SheetDescription>
      </SheetContent>
    </Sheet>
  );
}

describe("SheetContent visual overlay", () => {
  test("fades out before it unmounts and is reused when the sheet reopens", async () => {
    await withSheetAnimations(() => {
      const view = render(renderSheet(true));
      const overlay = screen.getByLabelText("Close sheet overlay");
      expect(overlay.getAttribute("data-state")).toBe("open");

      view.rerender(renderSheet(false));
      expect(overlay.isConnected).toBe(true);
      expect(overlay.getAttribute("data-state")).toBe("closed");

      view.rerender(renderSheet(true));
      expect(screen.getByLabelText("Close sheet overlay")).toBe(overlay);
      expect(overlay.getAttribute("data-state")).toBe("open");

      view.rerender(renderSheet(false));
      finishSheetExit();
      expect(overlay.isConnected).toBe(false);
    });
  });

  test("makes the closing content inert and hidden until it opens again", async () => {
    await withSheetAnimations(() => {
      const view = render(renderSheet(true));
      const content = screen.getByRole("dialog");
      expect(content.hasAttribute("inert")).toBe(false);
      expect(content.getAttribute("aria-hidden")).toBe("false");

      view.rerender(renderSheet(false));
      expect(content.isConnected).toBe(true);
      expect(content.hasAttribute("inert")).toBe(true);
      expect(content.getAttribute("aria-hidden")).toBe("true");

      view.rerender(renderSheet(true));
      expect(content.hasAttribute("inert")).toBe(false);
      expect(content.getAttribute("aria-hidden")).toBe("false");
      view.unmount();
    });
  });

  test("closes the sheet when the overlay is clicked", () => {
    const onOpenChange = mock((_open: boolean) => {});
    render(renderSheet(true, onOpenChange));

    fireEvent.click(screen.getByLabelText("Close sheet overlay"));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

// Task details shortcuts use the footer as the root of their owner.
test("SheetFooter gives its element to the caller ref until the sheet closes", () => {
  const footer = createRef<HTMLDivElement>();
  const renderFooterSheet = (open: boolean) => (
    <Sheet open={open}>
      <SheetContent>
        <SheetTitle>Task</SheetTitle>
        <SheetFooter ref={footer}>Actions</SheetFooter>
      </SheetContent>
    </Sheet>
  );
  const view = render(renderFooterSheet(true));
  try {
    expect(footer.current?.dataset.slot).toBe("sheet-footer");

    view.rerender(renderFooterSheet(false));
    expect(footer.current).toBeNull();
  } finally {
    view.unmount();
  }
});
