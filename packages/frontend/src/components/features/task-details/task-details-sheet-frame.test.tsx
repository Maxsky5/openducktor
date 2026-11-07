import { expect, mock, test } from "bun:test";
import { act, render } from "@testing-library/react";
import { TaskDetailsSheetFrame } from "./task-details-sheet-frame";

test("keeps the sheet open when a closing dialog returns focus to the page behind it", async () => {
  const onOpenChange = mock((_open: boolean) => {});
  const outside = document.createElement("button");
  document.body.append(outside);
  const view = render(
    <TaskDetailsSheetFrame open onOpenChange={onOpenChange}>
      <button type="button">Inside</button>
    </TaskDetailsSheetFrame>,
  );
  try {
    await act(async () => {
      outside.focus();
    });
    expect(onOpenChange).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    outside.remove();
  }
});
