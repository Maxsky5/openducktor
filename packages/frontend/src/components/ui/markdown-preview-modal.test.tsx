import { describe, expect, mock, test } from "bun:test";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { replaceNavigatorClipboard } from "@/test-utils/mock-clipboard";
import { withMockedToast } from "@/test-utils/mock-toast";
import { MarkdownPreviewModal } from "./markdown-preview-modal";

describe("MarkdownPreviewModal", () => {
  test("uses an accessible default title when the artifact has no title", async () => {
    await act(async () => {
      render(<MarkdownPreviewModal open onOpenChange={() => {}} markdown="# Content" />);
    });

    const dialog = screen.getByRole("dialog", { name: "Artifact preview" });
    expect(within(dialog).getByRole("heading", { name: "Content" }).textContent).toBe("Content");
  });

  test("renders the named artifact and copies its raw markdown", async () => {
    const writeClipboard = mock(async (_value: string) => {});
    const restoreClipboard = replaceNavigatorClipboard(writeClipboard);
    try {
      await withMockedToast(async ({ toastSuccessMock }) => {
        await act(async () => {
          render(
            <MarkdownPreviewModal
              open
              onOpenChange={() => {}}
              markdown="# Raw Markdown"
              title="Specification"
            />,
          );
        });
        const dialog = screen.getByRole("dialog", { name: "Specification" });
        expect(within(dialog).getByRole("heading", { name: "Raw Markdown" })).toBeDefined();

        await act(async () => {
          fireEvent.click(within(dialog).getByRole("button", { name: "Copy artifact content" }));
        });
        expect(writeClipboard).toHaveBeenCalledWith("# Raw Markdown");
        expect(toastSuccessMock).toHaveBeenCalledWith("Copied!", expect.anything());
      });
    } finally {
      restoreClipboard();
    }
  });
});
