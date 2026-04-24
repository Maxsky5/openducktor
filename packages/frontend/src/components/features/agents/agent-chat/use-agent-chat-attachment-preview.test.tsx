import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  configureShellBridge,
  createUnavailableShellBridge,
  type ShellBridge,
} from "@/lib/shell-bridge";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import {
  readAttachmentPreviewLoadFailureMessage,
  useAgentChatAttachmentPreview,
} from "./use-agent-chat-attachment-preview";

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

afterEach(() => {
  URL.createObjectURL = originalCreateObjectUrl;
  URL.revokeObjectURL = originalRevokeObjectUrl;
  configureShellBridge(createUnavailableShellBridge());
});

describe("useAgentChatAttachmentPreview", () => {
  test("opens file-backed previews and converts load failures into explicit error state", async () => {
    URL.createObjectURL = () => "blob:preview.png";
    URL.revokeObjectURL = () => {};

    const harness = createHookHarness(useAgentChatAttachmentPreview, {
      attachment: {
        id: "attachment-1",
        name: "preview.png",
        kind: "image" as const,
        mime: "image/png",
        file: new File(["image"], "preview.png", { type: "image/png" }),
      },
      externalError: null,
    });

    await harness.mount();
    await harness.waitFor((state) => state.showResolvedPreview === true);

    await harness.run((state) => {
      expect(state.requestPreviewOpen()).toBeNull();
    });
    expect(harness.getLatest().dialogOpen).toBe(true);

    await harness.run((state) => {
      state.markPreviewUnavailable();
    });

    expect(harness.getLatest().dialogOpen).toBe(false);
    expect(harness.getLatest().resolvedPreviewSrc).toBeNull();
    expect(harness.getLatest().effectiveError).toBe(
      readAttachmentPreviewLoadFailureMessage("preview.png"),
    );

    await harness.unmount();
  });

  test("still allows image preview when the chip is in validation error state", async () => {
    URL.createObjectURL = () => "blob:preview.png";
    URL.revokeObjectURL = () => {};

    const harness = createHookHarness(useAgentChatAttachmentPreview, {
      attachment: {
        id: "attachment-2",
        name: "preview.png",
        kind: "image" as const,
        mime: "image/png",
        file: new File(["image"], "preview.png", { type: "image/png" }),
      },
      externalError: "The selected model does not support image attachments.",
    });

    await harness.mount();
    await harness.waitFor((state) => state.showResolvedPreview === true);

    await harness.run((state) => {
      expect(state.requestPreviewOpen()).toBeNull();
    });

    expect(harness.getLatest().dialogOpen).toBe(true);
    expect(harness.getLatest().effectiveError).toBe(
      "The selected model does not support image attachments.",
    );

    await harness.unmount();
  });

  test("ignores stale preview load errors from an outdated blob url", async () => {
    URL.createObjectURL = () => "blob:active-preview";
    URL.revokeObjectURL = () => {};

    const harness = createHookHarness(useAgentChatAttachmentPreview, {
      attachment: {
        id: "attachment-3",
        name: "preview.png",
        kind: "image" as const,
        mime: "image/png",
        file: new File(["image"], "preview.png", { type: "image/png" }),
      },
      externalError: null,
    });

    await harness.mount();
    await harness.waitFor((state) => state.showResolvedPreview === true);

    await harness.run((state) => {
      state.markPreviewUnavailable("blob:stale-preview");
    });

    expect(harness.getLatest().resolvedPreviewSrc).toBe("blob:active-preview");
    expect(harness.getLatest().effectiveError).toBeNull();

    await harness.unmount();
  });

  test("resolves transcript image previews through the desktop asset protocol", async () => {
    configureAttachmentPreviewShellBridge(
      mock(
        async (path) =>
          `asset://localhost/${encodeURIComponent(`/tmp/openducktor-local-attachments/${path}`)}`,
      ),
    );

    const harness = createHookHarness(useAgentChatAttachmentPreview, {
      attachment: {
        id: "attachment-4",
        name: "preview.png",
        kind: "image" as const,
        mime: "image/png",
        path: "uuid-preview.png",
      },
      externalError: null,
    });

    await harness.mount();
    await harness.waitFor((state) => state.showResolvedPreview === true);

    expect(harness.getLatest().resolvedPreviewSrc).toBe(
      "asset://localhost/%2Ftmp%2Fopenducktor-local-attachments%2Fuuid-preview.png",
    );
    expect(harness.getLatest().previewError).toBeNull();

    await harness.unmount();
  });

  test("surfaces transcript preview resolution failures as explicit errors", async () => {
    configureAttachmentPreviewShellBridge(
      mock(async () => {
        throw new Error("Attachment path is not a staged local attachment.");
      }),
    );

    const harness = createHookHarness(useAgentChatAttachmentPreview, {
      attachment: {
        id: "attachment-5",
        name: "preview.png",
        kind: "image" as const,
        mime: "image/png",
        path: "/tmp/preview.png",
      },
      externalError: null,
    });

    await harness.mount();
    await harness.waitFor((state) => state.isResolvingPreview === false);

    expect(harness.getLatest().resolvedPreviewSrc).toBeNull();
    expect(harness.getLatest().previewError).toBe(
      "Attachment path is not a staged local attachment.",
    );

    await harness.unmount();
  });
});
