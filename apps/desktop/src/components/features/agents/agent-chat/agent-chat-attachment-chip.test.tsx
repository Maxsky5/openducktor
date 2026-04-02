import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentChatAttachmentChip } from "./agent-chat-attachment-chip";

const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;

afterEach(() => {
  URL.createObjectURL = originalCreateObjectUrl;
  URL.revokeObjectURL = originalRevokeObjectUrl;
});

describe("AgentChatAttachmentChip", () => {
  test("surfaces preview load failures and closes the dialog", async () => {
    URL.createObjectURL = () => "blob:preview.png";
    URL.revokeObjectURL = () => {};

    render(
      <AgentChatAttachmentChip
        variant="draft"
        attachment={{
          id: "attachment-1",
          name: "preview.png",
          kind: "image",
          mime: "image/png",
          file: new File(["image"], "preview.png", { type: "image/png" }),
        }}
        onRemove={() => {}}
      />,
    );

    const previewButton = screen
      .getAllByRole("button")
      .find((button) => button.getAttribute("aria-label") === null);
    if (!previewButton) {
      throw new Error("Expected preview button");
    }
    fireEvent.click(previewButton);
    await screen.findByText("Image preview");

    const dialogImage = screen
      .getAllByAltText("preview.png")
      .find((image) => image.className.includes("object-contain"));
    if (!(dialogImage instanceof HTMLElement)) {
      throw new Error("Expected fullscreen preview image");
    }
    fireEvent.error(dialogImage);

    await waitFor(() => {
      expect(
        screen.getByText(
          'Attachment preview is unavailable because "preview.png" could not be read from its original local path.',
        ),
      ).toBeDefined();
    });
    await waitFor(() => {
      expect(screen.queryByText("Image preview")).toBeNull();
    });
  });

  test("does not poison preview opening when the inline thumbnail errors during rerender", async () => {
    URL.createObjectURL = () => "blob:preview-inline.png";
    URL.revokeObjectURL = () => {};

    render(
      <AgentChatAttachmentChip
        variant="transcript"
        attachment={{
          id: "attachment-3",
          path: "/tmp/preview-inline.png",
          name: "preview-inline.png",
          kind: "image",
          mime: "image/png",
        }}
      />,
    );

    const thumbnailImage = await screen.findByAltText("preview-inline.png");
    fireEvent.error(thumbnailImage);

    expect(
      screen.queryByText(
        'Attachment preview is unavailable because "preview-inline.png" could not be read from its original local path.',
      ),
    ).toBeNull();

    const previewButton = screen
      .getAllByRole("button")
      .find((button) => button.getAttribute("aria-label") === null);
    if (!previewButton) {
      throw new Error("Expected preview button");
    }
    fireEvent.click(previewButton);

    await screen.findByText("Image preview");
  });

  test("exposes the full attachment name on hover", () => {
    render(
      <AgentChatAttachmentChip
        variant="draft"
        attachment={{
          id: "attachment-2",
          name: "very-long-screenshot-file-name-that-should-truncate.png",
          kind: "pdf",
          mime: "application/pdf",
          path: "/tmp/very-long-screenshot-file-name-that-should-truncate.png",
        }}
        onRemove={() => {}}
      />,
    );

    expect(
      screen.getByTitle("very-long-screenshot-file-name-that-should-truncate.png"),
    ).toBeDefined();
  });
});
