import { afterEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { hostClient } from "@/lib/host-client";
import { AgentChatAttachmentChip } from "./agent-chat-attachment-chip";

type TestWindow = Window &
  typeof globalThis & {
    __TAURI_INTERNALS__?: {
      convertFileSrc: (path: string, protocol?: string) => string;
    };
  };

const testWindow = window as TestWindow;
const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;
const originalResolveLocalAttachmentPath = hostClient.workspaceResolveLocalAttachmentPath;
const originalTauriInternals = testWindow.__TAURI_INTERNALS__;

const installMockTauriRuntime = (): void => {
  testWindow.__TAURI_INTERNALS__ = {
    convertFileSrc: (path: string, protocol = "asset") =>
      `${protocol}://localhost/${encodeURIComponent(path)}`,
  };
};

afterEach(() => {
  URL.createObjectURL = originalCreateObjectUrl;
  URL.revokeObjectURL = originalRevokeObjectUrl;
  hostClient.workspaceResolveLocalAttachmentPath = originalResolveLocalAttachmentPath;
  if (originalTauriInternals) {
    testWindow.__TAURI_INTERNALS__ = originalTauriInternals;
    return;
  }
  delete testWindow.__TAURI_INTERNALS__;
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
    hostClient.workspaceResolveLocalAttachmentPath = mock(async ({ path }) => ({
      path: `/tmp/openducktor-local-attachments/${path}`,
    }));
    installMockTauriRuntime();

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

  test("renders transcript image previews from the resolved desktop asset url", async () => {
    hostClient.workspaceResolveLocalAttachmentPath = mock(async ({ path }) => ({
      path: `/tmp/openducktor-local-attachments/${path}`,
    }));
    installMockTauriRuntime();

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

    const thumbnailImage = await screen.findByAltText("preview-dialog.png");
    expect(thumbnailImage.getAttribute("src")).toBe(
      "asset://localhost/%2Ftmp%2Fopenducktor-local-attachments%2Fuuid-preview-dialog.png",
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
      .getAllByAltText("preview-dialog.png")
      .find((image) => image.className.includes("object-contain"));
    if (!(dialogImage instanceof HTMLElement)) {
      throw new Error("Expected fullscreen preview image");
    }
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
