import { afterEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  configureShellBridge,
  createUnavailableShellBridge,
  type ShellBridge,
} from "@/lib/shell-bridge";
import { AgentChatAttachmentChip } from "./agent-chat-attachment-chip";

const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;

const configureAttachmentPreviewShellBridge = (
  resolveLocalAttachmentPreviewSrc: ShellBridge["resolveLocalAttachmentPreviewSrc"],
): void => {
  configureShellBridge({
    client: {} as ShellBridge["client"],
    subscribeRunEvents: async () => () => {},
    subscribeDevServerEvents: async () => () => {},
    subscribeTaskEvents: async () => () => {},
    capabilities: {
      canOpenExternalUrls: true,
      canPreviewLocalAttachments: true,
    },
    openExternalUrl: async () => {},
    resolveLocalAttachmentPreviewSrc,
  });
};

const getPreviewButton = (): HTMLElement => {
  const previewButton = screen
    .getAllByRole("button")
    .find((button) => button.getAttribute("aria-label") === null);
  if (!previewButton) {
    throw new Error("Expected preview button");
  }
  return previewButton;
};

const getThumbnailImage = (name: string): HTMLImageElement => {
  const thumbnailImage = screen
    .getAllByAltText(name)
    .find((image) => image.className.includes("object-cover"));
  if (!(thumbnailImage instanceof HTMLImageElement)) {
    throw new Error(`Expected thumbnail image for ${name}`);
  }
  return thumbnailImage;
};

const getDialogImage = (name: string): HTMLImageElement => {
  const dialogImage = screen
    .getAllByAltText(name)
    .find((image) => image.className.includes("object-contain"));
  if (!(dialogImage instanceof HTMLImageElement)) {
    throw new Error(`Expected dialog image for ${name}`);
  }
  return dialogImage;
};

afterEach(() => {
  URL.createObjectURL = originalCreateObjectUrl;
  URL.revokeObjectURL = originalRevokeObjectUrl;
  configureShellBridge(createUnavailableShellBridge());
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

    fireEvent.click(getPreviewButton());
    await screen.findByText("Image preview");

    const dialogImage = getDialogImage("preview.png");
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

  test("surfaces inline thumbnail failures as explicit preview errors", async () => {
    configureAttachmentPreviewShellBridge(
      mock(
        async (path) =>
          `asset://localhost/${encodeURIComponent(`/tmp/openducktor-local-attachments/${path}`)}`,
      ),
    );

    render(
      <AgentChatAttachmentChip
        variant="transcript"
        attachment={{
          id: "attachment-3",
          path: "uuid-preview-inline.png",
          name: "preview-inline.png",
          kind: "image",
          mime: "image/png",
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByAltText("preview-inline.png").length).toBeGreaterThan(0);
    });
    const thumbnailImage = getThumbnailImage("preview-inline.png");
    fireEvent.error(thumbnailImage);

    await waitFor(() => {
      expect(
        screen.getByText(
          'Attachment preview is unavailable because "preview-inline.png" could not be read from its original local path.',
        ),
      ).toBeDefined();
    });

    fireEvent.click(getPreviewButton());

    await waitFor(() => {
      expect(screen.queryByText("Image preview")).toBeNull();
    });
  });

  test("renders transcript image previews from the resolved desktop asset url", async () => {
    configureAttachmentPreviewShellBridge(
      mock(
        async (path) =>
          `asset://localhost/${encodeURIComponent(`/tmp/openducktor-local-attachments/${path}`)}`,
      ),
    );

    render(
      <AgentChatAttachmentChip
        variant="transcript"
        attachment={{
          id: "attachment-4",
          path: "uuid-preview-dialog.png",
          name: "preview-dialog.png",
          kind: "image",
          mime: "image/png",
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByAltText("preview-dialog.png").length).toBeGreaterThan(0);
    });
    const thumbnailImage = getThumbnailImage("preview-dialog.png");
    expect(thumbnailImage.getAttribute("src")).toBe(
      "asset://localhost/%2Ftmp%2Fopenducktor-local-attachments%2Fuuid-preview-dialog.png",
    );

    fireEvent.click(getPreviewButton());

    await screen.findByText("Image preview");
    const dialogImage = getDialogImage("preview-dialog.png");
    expect(dialogImage.getAttribute("src")).toBe(
      "asset://localhost/%2Ftmp%2Fopenducktor-local-attachments%2Fuuid-preview-dialog.png",
    );
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
