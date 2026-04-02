import { afterEach, describe, expect, mock, test } from "bun:test";
import { hostClient } from "@/lib/host-client";
import {
  buildBrowserLocalAttachmentPreviewUrl,
  resolveLocalAttachmentPreviewSrc,
} from "./local-attachment-files";

const originalResolveLocalAttachmentPath = hostClient.workspaceResolveLocalAttachmentPath;

afterEach(() => {
  hostClient.workspaceResolveLocalAttachmentPath = originalResolveLocalAttachmentPath;
});

describe("local-attachment-files", () => {
  test("buildBrowserLocalAttachmentPreviewUrl normalizes the backend base URL", () => {
    expect(
      buildBrowserLocalAttachmentPreviewUrl("http://127.0.0.1:14327/", "/tmp/preview.png"),
    ).toBe("http://127.0.0.1:14327/local-attachment-preview?path=%2Ftmp%2Fpreview.png");
  });

  test("resolveLocalAttachmentPreviewSrc rejects blank paths before runtime branching", async () => {
    await expect(resolveLocalAttachmentPreviewSrc("   ")).rejects.toThrow(
      "Attachment preview is unavailable because the local file path is missing.",
    );
  });

  test("resolveLocalAttachmentPreviewSrc resolves staged filename tokens before building browser preview urls", async () => {
    hostClient.workspaceResolveLocalAttachmentPath = mock(async ({ path }) => ({
      path: `/tmp/openducktor-local-attachments/uuid-${path}`,
    }));

    await expect(
      resolveLocalAttachmentPreviewSrc("Screenshot-2026-03-16-at-23.48.30.png"),
    ).resolves.toBe(
      "/tmp/openducktor-local-attachments/uuid-Screenshot-2026-03-16-at-23.48.30.png",
    );
  });
});
