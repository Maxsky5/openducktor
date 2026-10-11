import { describe, expect, mock, spyOn, test } from "bun:test";
import type { AgentMessageSubmitMode } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { isApplePlatform } from "@/lib/steer-shortcut";
import { AgentChatComposer } from "./agent-chat-composer";
import { type AgentChatComposerDraft, draftToSerializedText } from "./agent-chat-composer-draft";
import { buildModel, typeIntoComposer } from "./agent-chat-composer-test-helpers";

const getEditorRoot = (container: HTMLElement): HTMLElement => {
  const editorRoot = container.querySelector('[contenteditable="true"]');
  if (!(editorRoot instanceof HTMLElement)) {
    throw new Error("Expected editable composer root");
  }
  return editorRoot;
};

const steerKeyDown = (container: HTMLElement): void => {
  fireEvent.keyDown(getEditorRoot(container), {
    key: "Enter",
    ...(isApplePlatform() ? { metaKey: true } : { ctrlKey: true }),
  });
};

// The table in agent-chat-steering.test.ts covers each steering rule. These tests cover how the
// composer applies the rules.
describe("AgentChatComposer steering", () => {
  test("steers an attachment that the running turn takes, though the selected model cannot", async () => {
    const pdfModel: AgentModelCatalog["models"][number] = {
      id: "openai/gpt-5",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5",
      modelName: "GPT-5",
      variants: [],
      attachmentSupport: { image: false, audio: false, video: false, pdf: true },
    };
    const onSend = mock(
      async (_draft: AgentChatComposerDraft, _mode: AgentMessageSubmitMode) => true,
    );
    // The user selects a text-only model for later messages while the turn reads PDF files.
    const { container, unmount } = render(
      <AgentChatComposer
        model={{
          ...buildModel(),
          isSessionWorking: true,
          selectedModelDescriptor: {
            ...pdfModel,
            id: "openai/gpt-text",
            modelId: "gpt-text",
            attachmentSupport: { image: false, audio: false, video: false, pdf: false },
          },
          runningTurnModel: pdfModel,
          onSend,
        }}
      />,
    );
    try {
      const input = container.querySelector('input[type="file"]');
      if (!(input instanceof HTMLInputElement)) throw new Error("Expected attachment input");
      fireEvent.change(input, {
        target: { files: [new File(["pdf"], "brief.pdf", { type: "application/pdf" })] },
      });
      await screen.findByTitle("brief.pdf");
      typeIntoComposer(container, "see the brief");
      steerKeyDown(container);

      await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1), { timeout: 300 });
      const [draft, mode] = onSend.mock.calls[0] ?? [];
      expect(mode).toBe("steer");
      expect(draft ? draftToSerializedText(draft) : null).toBe("see the brief");
      expect(draft?.attachments?.map((attachment) => attachment.name)).toEqual(["brief.pdf"]);
    } finally {
      unmount();
    }
  });

  test("keeps the draft and reports why steering is blocked", () => {
    const onSend = mock(async () => true);
    const failure = spyOn(toast, "error").mockImplementation(() => "failure");
    const { container, unmount } = render(
      <AgentChatComposer
        model={{
          ...buildModel(),
          isSessionWorking: true,
          steerBlockedReason: "OpenCode 1.0.0 cannot steer running work.",
          onSend,
        }}
      />,
    );
    try {
      typeIntoComposer(container, "change course");
      steerKeyDown(container);
      expect(failure).toHaveBeenCalledWith("Cannot steer this message", {
        description: "OpenCode 1.0.0 cannot steer running work.",
      });
      expect(onSend).not.toHaveBeenCalled();
      expect(getEditorRoot(container).textContent).toBe("change course");
    } finally {
      unmount();
      failure.mockRestore();
    }
  });
});
