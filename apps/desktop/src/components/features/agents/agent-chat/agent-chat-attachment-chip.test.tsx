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
        attachment={{
          id: "attachment-1",
          name: "preview.png",
          kind: "image",
          mime: "image/png",
          file: new File(["image"], "preview.png", { type: "image/png" }),
        }}
      />,
    );

    const previewButton = await screen.findByRole("button", { name: /preview.png/i });
    fireEvent.click(previewButton);
    await screen.findByText("Image preview");

    const renderedImages = screen.getAllByAltText("preview.png");
    const dialogImage = renderedImages[renderedImages.length - 1];
    if (!dialogImage) {
      throw new Error("Expected preview image in dialog");
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
});
