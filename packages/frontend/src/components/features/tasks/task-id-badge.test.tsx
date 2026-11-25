import { expect, mock, spyOn, test } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TaskIdBadge } from "./task-id-badge";

test("copies the visible task ID without clicking its parent", async () => {
  const parentClick = mock(() => {});
  const write = spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  try {
    render(
      <div onClick={parentClick}>
        <TaskIdBadge taskId="TASK-ABC" />
      </div>,
    );
    const id = screen.getByText("TASK-ABC");
    const copy = screen.getByRole("button", { name: "Copy task ID" });
    expect(id.compareDocumentPosition(copy)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    await act(async () => {
      fireEvent.click(copy);
    });
    expect(write).toHaveBeenCalledWith("TASK-ABC");
    expect(parentClick).not.toHaveBeenCalled();
  } finally {
    write.mockRestore();
  }
});
