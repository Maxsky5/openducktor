import { afterEach, describe, expect, mock, test } from "bun:test";
import type { TauriHostClient } from "@openducktor/adapters-tauri-host";
import { resolveLocalAttachmentPreviewSrc } from "./local-attachment-files";
import {
  configureShellBridge,
  createUnavailableShellBridge,
  type ShellBridge,
} from "./shell-bridge";

const createTestShellBridge = (overrides: Partial<ShellBridge> = {}): ShellBridge => ({
  client: {} as TauriHostClient,
  subscribeRunEvents: async () => () => {},
  subscribeDevServerEvents: async () => () => {},
  subscribeTaskEvents: async () => () => {},
  capabilities: {
    canOpenExternalUrls: true,
    canPreviewLocalAttachments: true,
  },
  openExternalUrl: async () => {},
  resolveLocalAttachmentPreviewSrc: async () => "asset://preview",
  ...overrides,
});

afterEach(() => {
  configureShellBridge(createUnavailableShellBridge());
});

describe("local-attachment-files", () => {
  test("resolveLocalAttachmentPreviewSrc rejects blank paths before shell delegation", async () => {
    await expect(resolveLocalAttachmentPreviewSrc("   ")).rejects.toThrow(
      "Attachment preview is unavailable because the local file path is missing.",
    );
  });

  test("resolveLocalAttachmentPreviewSrc trims and delegates preview URL resolution to the shell bridge", async () => {
    const resolveLocalAttachmentPreviewSrcForShell = mock(
      async () => "asset://localhost/preview.png",
    );
    configureShellBridge(
      createTestShellBridge({
        resolveLocalAttachmentPreviewSrc: resolveLocalAttachmentPreviewSrcForShell,
      }),
    );

    await expect(resolveLocalAttachmentPreviewSrc("  Screenshot.png  ")).resolves.toBe(
      "asset://localhost/preview.png",
    );
    expect(resolveLocalAttachmentPreviewSrcForShell).toHaveBeenCalledWith("Screenshot.png");
  });

  test("resolveLocalAttachmentPreviewSrc surfaces shell validation errors", async () => {
    configureShellBridge(
      createTestShellBridge({
        resolveLocalAttachmentPreviewSrc: async () => {
          throw new Error("Attachment path is not a staged local attachment.");
        },
      }),
    );

    await expect(resolveLocalAttachmentPreviewSrc("/tmp/preview.png")).rejects.toThrow(
      "Attachment path is not a staged local attachment.",
    );
  });
});
