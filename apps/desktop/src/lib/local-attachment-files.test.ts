import { afterEach, describe, expect, mock, test } from "bun:test";
import { hostClient } from "@/lib/host-client";
import {
  buildBrowserLocalAttachmentPreviewUrl,
  resolveLocalAttachmentPreviewSrc,
} from "./local-attachment-files";

type TestWindow = Window &
  typeof globalThis & {
    __TAURI_INTERNALS__?: {
      convertFileSrc: (path: string, protocol?: string) => string;
    };
  };

const testWindow = window as TestWindow;
const originalResolveLocalAttachmentPath = hostClient.workspaceResolveLocalAttachmentPath;
const originalTauriInternals = testWindow.__TAURI_INTERNALS__;

const installMockTauriRuntime = (
  convertFileSrc: (path: string, protocol?: string) => string = (path, protocol = "asset") =>
    `${protocol}://localhost/${encodeURIComponent(path)}`,
): void => {
  testWindow.__TAURI_INTERNALS__ = {
    convertFileSrc,
  };
};

afterEach(() => {
  hostClient.workspaceResolveLocalAttachmentPath = originalResolveLocalAttachmentPath;
  if (originalTauriInternals) {
    testWindow.__TAURI_INTERNALS__ = originalTauriInternals;
    return;
  }
  delete testWindow.__TAURI_INTERNALS__;
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

  test("resolveLocalAttachmentPreviewSrc validates absolute staged paths before building desktop preview urls", async () => {
    const stagedPath = "/tmp/openducktor-local-attachments/uuid-preview.png";
    hostClient.workspaceResolveLocalAttachmentPath = mock(async ({ path }) => ({ path }));
    installMockTauriRuntime((path, protocol = "asset") => {
      expect(path).toBe(stagedPath);
      expect(protocol).toBe("asset");
      return `${protocol}://localhost/${encodeURIComponent(path)}`;
    });

    await expect(resolveLocalAttachmentPreviewSrc(stagedPath)).resolves.toBe(
      "asset://localhost/%2Ftmp%2Fopenducktor-local-attachments%2Fuuid-preview.png",
    );
    expect(hostClient.workspaceResolveLocalAttachmentPath).toHaveBeenCalledWith({
      path: stagedPath,
    });
  });

  test("resolveLocalAttachmentPreviewSrc resolves staged filename tokens before building desktop preview urls", async () => {
    hostClient.workspaceResolveLocalAttachmentPath = mock(async ({ path }) => ({
      path: `/tmp/openducktor-local-attachments/uuid-${path}`,
    }));
    installMockTauriRuntime();

    await expect(
      resolveLocalAttachmentPreviewSrc("Screenshot-2026-03-16-at-23.48.30.png"),
    ).resolves.toBe(
      "asset://localhost/%2Ftmp%2Fopenducktor-local-attachments%2Fuuid-Screenshot-2026-03-16-at-23.48.30.png",
    );
  });

  test("resolveLocalAttachmentPreviewSrc surfaces host validation errors for non-staged absolute paths", async () => {
    hostClient.workspaceResolveLocalAttachmentPath = mock(async () => {
      throw new Error("Attachment path is not a staged local attachment.");
    });

    await expect(resolveLocalAttachmentPreviewSrc("/tmp/preview.png")).rejects.toThrow(
      "Attachment path is not a staged local attachment.",
    );
  });
});
