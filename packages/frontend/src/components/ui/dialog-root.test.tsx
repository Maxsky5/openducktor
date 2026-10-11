import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { Dialog, DialogContent, DialogTitle } from "./dialog";
import { hasOpenDialog } from "./open-dialogs";
import { Sheet, SheetContent, SheetTitle } from "./sheet";

afterEach(cleanup);

describe("hasOpenDialog", () => {
  test("reports each open dialog and sheet until it closes or unmounts", () => {
    const renderRoots = (dialogOpen: boolean, sheetOpen: boolean) => (
      <>
        <Dialog open={dialogOpen}>
          <DialogContent>
            <DialogTitle>Dialog</DialogTitle>
          </DialogContent>
        </Dialog>
        <Sheet modal={false} open={sheetOpen}>
          <SheetContent>
            <SheetTitle>Sheet</SheetTitle>
          </SheetContent>
        </Sheet>
      </>
    );
    const view = render(renderRoots(false, false));
    expect(hasOpenDialog()).toBe(false);

    view.rerender(renderRoots(true, true));
    expect(hasOpenDialog()).toBe(true);

    view.rerender(renderRoots(false, true));
    expect(hasOpenDialog()).toBe(true);

    view.rerender(renderRoots(false, false));
    expect(hasOpenDialog()).toBe(false);

    view.rerender(renderRoots(true, false));
    view.unmount();
    expect(hasOpenDialog()).toBe(false);
  });
});
