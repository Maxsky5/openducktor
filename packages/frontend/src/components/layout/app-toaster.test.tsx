import { afterEach, expect, mock, test } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetFooter, SheetTitle } from "@/components/ui/sheet";
import { QueryProvider } from "@/test-utils/query-provider";
import { restoreAfterTestBody } from "@/test-utils/restore-after-test-body";
import { AppToaster } from "./app-toaster";

const FOOTER_HEIGHT = 60;

afterEach(() => {
  toast.dismiss();
});

test("keeps toasts above the footer of an open sheet", async () => {
  const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  if (offsetHeight === undefined) throw new Error("HTMLElement has no offsetHeight.");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.slot === "sheet-footer" ? FOOTER_HEIGHT : 0;
    },
  });
  const restore = restoreAfterTestBody(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeight);
  });
  const renderView = (open: boolean) => (
    <QueryProvider>
      <AppToaster />
      <Sheet open={open}>
        <SheetContent>
          <SheetTitle>Task</SheetTitle>
          <SheetFooter>Actions</SheetFooter>
        </SheetContent>
      </Sheet>
    </QueryProvider>
  );
  const view = render(renderView(true));
  try {
    act(() => {
      toast("Copied!");
    });
    await screen.findByText("Copied!");
    const toaster = document.querySelector<HTMLElement>("[data-sonner-toaster]");
    if (toaster === null) throw new Error("The toaster is missing.");
    expect(toaster.style.getPropertyValue("--offset-bottom")).toBe(`${16 + FOOTER_HEIGHT}px`);

    view.rerender(renderView(false));
    expect(toaster.style.getPropertyValue("--offset-bottom")).toBe("16px");
  } finally {
    view.unmount();
    restore();
  }
});

test("keeps a modal dialog open when the user closes a toast above it", async () => {
  const onOpenChange = mock((_open: boolean) => {});
  const onDismiss = mock(() => {});
  const view = render(
    <QueryProvider>
      <AppToaster />
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Link pull request</DialogTitle>
        </DialogContent>
      </Dialog>
    </QueryProvider>,
  );
  try {
    act(() => {
      toast.error("The pull request could not be linked.", { onDismiss });
    });
    const closeToast = await screen.findByRole("button", { name: "Close toast" });
    fireEvent.pointerDown(closeToast);
    fireEvent.click(closeToast);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  } finally {
    view.unmount();
  }
});
