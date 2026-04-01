import { describe, expect, test } from "bun:test";
import {
  buildBrowserLocalAttachmentPreviewUrl,
  resolveLocalAttachmentPreviewSrc,
} from "./local-attachment-files";

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
});
