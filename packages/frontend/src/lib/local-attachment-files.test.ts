import { afterEach, describe, expect, mock, test } from "bun:test";
import { LOCAL_ATTACHMENT_BYTE_LIMIT } from "@openducktor/contracts";
import { createHostClientFixture } from "@/test-utils/focused-fixture";
import {
  createBrowserAttachmentStager,
  resolveLocalAttachmentPreview,
} from "./local-attachment-files";
import {
  configureShellBridge,
  createDisabledAppUpdateBridge,
  createUnavailableShellBridge,
  type ShellBridge,
} from "./shell-bridge";

const createTestShellBridge = (overrides: Partial<ShellBridge> = {}): ShellBridge => ({
  getArtifactPreviewEnvironment: createUnavailableShellBridge().getArtifactPreviewEnvironment,
  client: createHostClientFixture({}),
  subscribeWorkspaceSessionUpdates: async () => () => {},
  subscribeRuntimeChanges: async () => () => {},
  subscribeTaskMergeStatusUpdates: async () => () => {},
  subscribeBrowserTabEvents: async () => () => {},
  subscribeRunEvents: async () => () => {},
  subscribeWorkspaceProviderSetupUpdates: async () => () => {},
  subscribeAzureDevOpsConnectionUpdates: async () => () => {},
  observeAgentSessionLive: async () => () => {},
  subscribeNotificationStream: async () => () => {},
  subscribeTaskStream: async () => ({
    subscriptionId: "test-subscription",
    acknowledge: async () => {},
    unsubscribe: () => {},
  }),
  appUpdates: createDisabledAppUpdateBridge({
    status: "disabled",
    currentVersion: "unknown",
    disabledCode: "updater_unavailable",
    disabledReason: "Updates are unavailable in this test shell.",
  }),
  capabilities: {
    canOpenExternalUrls: true,
    canPreviewLocalAttachments: true,
  },
  notifications: createUnavailableShellBridge().notifications,
  openExternalUrl: async () => {},
  resolveLocalAttachmentPreview: async () => ({ kind: "url", src: "asset://preview" }),
  resolveTaskAssetSource: async () => ({ kind: "url", src: "asset://task-preview" }),
  terminals: createUnavailableShellBridge().terminals,
  browser: createUnavailableShellBridge().browser,
  ...overrides,
});

afterEach(() => {
  configureShellBridge(createUnavailableShellBridge());
});

describe("local-attachment-files", () => {
  test("browser attachment stager rejects oversized files before reading them", async () => {
    const workspaceStageLocalAttachment = mock(async () => ({ path: "/tmp/staged/oversized.pdf" }));
    const stage = createBrowserAttachmentStager({ workspaceStageLocalAttachment });
    const file = new File([], "oversized.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "size", { value: LOCAL_ATTACHMENT_BYTE_LIMIT + 1 });
    const arrayBuffer = mock(file.arrayBuffer.bind(file));
    file.arrayBuffer = arrayBuffer;

    await expect(stage(file)).rejects.toThrow("Attachments must total 32 MiB or less.");
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(workspaceStageLocalAttachment).not.toHaveBeenCalled();
  });

  test("browser attachment stager rejects a file reference that is not a browser file", async () => {
    const workspaceStageLocalAttachment = mock(async () => ({ path: "/tmp/staged/notes.txt" }));
    const stage = createBrowserAttachmentStager({ workspaceStageLocalAttachment });

    await expect(stage({ name: "notes.txt", type: "text/plain", size: 5 })).rejects.toThrow(
      'Attachment "notes.txt" is not a browser file.',
    );
    expect(workspaceStageLocalAttachment).not.toHaveBeenCalled();
  });

  test("browser attachment stager sends the exact file bytes as base64", async () => {
    const workspaceStageLocalAttachment = mock(async () => ({ path: "/tmp/staged/bytes.bin" }));
    const stage = createBrowserAttachmentStager({ workspaceStageLocalAttachment });
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);

    await expect(stage(new File([bytes], "bytes.bin", { type: "application/pdf" }))).resolves.toBe(
      "/tmp/staged/bytes.bin",
    );
    expect(workspaceStageLocalAttachment).toHaveBeenCalledWith({
      name: "bytes.bin",
      base64Data: Buffer.from(bytes).toString("base64"),
      mime: "application/pdf",
    });
  });

  test("browser attachment stager keeps exact bytes when the media type contains a comma", async () => {
    const workspaceStageLocalAttachment = mock(async () => ({ path: "/tmp/staged/diagram.png" }));
    const stage = createBrowserAttachmentStager({ workspaceStageLocalAttachment });
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    const type = 'image/png;foo="a,b"';

    await stage(new File([bytes], "diagram.png", { type }));
    expect(workspaceStageLocalAttachment).toHaveBeenCalledWith({
      name: "diagram.png",
      base64Data: Buffer.from(bytes).toString("base64"),
      mime: type,
    });
  });

  test("resolveLocalAttachmentPreview rejects blank paths before shell delegation", async () => {
    await expect(
      resolveLocalAttachmentPreview("   ", new AbortController().signal),
    ).rejects.toThrow("Attachment preview is unavailable because the local file path is missing.");
  });

  test("resolveLocalAttachmentPreview keeps native inline image bytes without reading a local file", async () => {
    const uri = "data:image/png;base64,aW1hZ2U=";
    const resolveForShell = mock(async () => {
      throw new Error("Inline runtime attachments have no local file.");
    });
    configureShellBridge(createTestShellBridge({ resolveLocalAttachmentPreview: resolveForShell }));

    expect(await resolveLocalAttachmentPreview(uri, new AbortController().signal)).toEqual({
      kind: "url",
      src: uri,
    });
    expect(resolveForShell).not.toHaveBeenCalled();
  });

  test("resolveLocalAttachmentPreview trims and delegates preview URL resolution to the shell bridge", async () => {
    const resolveLocalAttachmentPreviewSrcForShell = mock(async () => ({
      kind: "url" as const,
      src: "asset://localhost/preview.png",
    }));
    configureShellBridge(
      createTestShellBridge({
        resolveLocalAttachmentPreview: resolveLocalAttachmentPreviewSrcForShell,
      }),
    );

    const signal = new AbortController().signal;
    await expect(resolveLocalAttachmentPreview("  Screenshot.png  ", signal)).resolves.toEqual({
      kind: "url",
      src: "asset://localhost/preview.png",
    });
    expect(resolveLocalAttachmentPreviewSrcForShell).toHaveBeenCalledWith("Screenshot.png", signal);
  });

  test("resolveLocalAttachmentPreview surfaces shell validation errors", async () => {
    configureShellBridge(
      createTestShellBridge({
        resolveLocalAttachmentPreview: async () => {
          throw new Error("Attachment path is not a staged local attachment.");
        },
      }),
    );

    await expect(
      resolveLocalAttachmentPreview("/tmp/preview.png", new AbortController().signal),
    ).rejects.toThrow("Attachment path is not a staged local attachment.");
  });
});
