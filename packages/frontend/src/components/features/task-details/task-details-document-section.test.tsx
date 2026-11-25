import { expect, mock, test } from "bun:test";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { FileText } from "lucide-react";
import { replaceNavigatorClipboard } from "@/test-utils/mock-clipboard";
import { withMockedToast } from "@/test-utils/mock-toast";
import { TaskDetailsDocumentSection } from "./task-details-document-section";

await import("./task-details-markdown-content");

test("keeps the fullscreen description readable and copyable after the task description clears", async () => {
  await withMockedToast(async () => {
    const original = "# Original description";
    const writeClipboard = mock(async (_value: string) => {});
    const restoreClipboard = replaceNavigatorClipboard(writeClipboard);
    const section = (markdown: string) => (
      <TaskDetailsDocumentSection
        title="Description"
        icon={<FileText />}
        markdown={markdown}
        empty="No description."
        defaultExpanded
      />
    );

    try {
      const view = render(section(original));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Open Description in fullscreen" }));
      });

      const dialog = screen.getByRole("dialog", { name: "Description" });
      await act(async () => view.rerender(section("")));
      expect(
        screen.queryByRole("button", { name: "Open Description in fullscreen", hidden: true }),
      ).toBeNull();
      expect(view.container.textContent).toContain("No description.");
      expect(within(dialog).getByRole("heading", { name: "Original description" })).toBeTruthy();

      await act(async () => {
        fireEvent.click(within(dialog).getByRole("button", { name: "Copy artifact content" }));
      });
      expect(writeClipboard).toHaveBeenCalledWith(original);
    } finally {
      restoreClipboard();
    }
  });
});
