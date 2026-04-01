import { afterEach, describe, expect, test } from "bun:test";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import {
  readAttachmentPreviewLoadFailureMessage,
  useAgentChatAttachmentPreview,
} from "./use-agent-chat-attachment-preview";

const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;

afterEach(() => {
  URL.createObjectURL = originalCreateObjectUrl;
  URL.revokeObjectURL = originalRevokeObjectUrl;
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
});
