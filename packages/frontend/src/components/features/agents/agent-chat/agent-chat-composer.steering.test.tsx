import { QueryProvider } from "@/test-utils/query-provider";
import type { ReactNode } from "react";
import { describe, expect, mock, spyOn, test } from "bun:test";
import { DEFAULT_CHAT_SETTINGS, type AgentMessageSubmitMode } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { fireEvent, render as renderView, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { isApplePlatform } from "@/lib/device-platform";
import { AgentChatComposer } from "./agent-chat-composer-test-helpers";
import {
  type AgentChatComposerDraft,
  draftToSerializedText,
} from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import { buildModel, typeIntoComposer } from "./agent-chat-composer-test-helpers";

const render = (element: ReactNode) => renderView(element, { wrapper: QueryProvider });

const getEditorRoot = (container: HTMLElement): HTMLElement => {
  const editorRoot = container.querySelector('[contenteditable="true"]');
  if (!(editorRoot instanceof HTMLElement)) {
    throw new Error("Expected editable composer root");
  }
  return editorRoot;
};

const pressAlternateShortcut = (container: HTMLElement): void => {
  fireEvent.keyDown(getEditorRoot(container), {
    key: "Enter",
    ...(isApplePlatform() ? { metaKey: true } : { ctrlKey: true }),
  });
};

// The table in agent-chat-steering.test.ts covers each steering rule. These tests cover how the
// composer applies the rules.
describe("AgentChatComposer steering", () => {
  test.each([false, true])(
    "steers an attachment using the running model with default steering %s",
    async (steerMessagesByDefault) => {
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
      const { container, unmount } = render(
        <AgentChatComposer
          settings={{ ...DEFAULT_CHAT_SETTINGS, steerMessagesByDefault }}
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
        if (steerMessagesByDefault) {
          expect(
            screen.getByRole("button", { name: "Send message" }).hasAttribute("disabled"),
          ).toBe(false);
          fireEvent.click(screen.getByRole("button", { name: "Send message" }));
        } else {
          pressAlternateShortcut(container);
        }

        await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1), { timeout: 300 });
        const [draft, mode] = onSend.mock.calls[0] ?? [];
        expect(mode).toBe("steer");
        expect(draft ? draftToSerializedText(draft) : null).toBe("see the brief");
        expect(draft?.attachments?.map((attachment) => attachment.name)).toEqual(["brief.pdf"]);
      } finally {
        unmount();
      }
    },
  );

  test.each([false, true])(
    "keeps a blocked steer draft with default steering %s",
    (steerMessagesByDefault) => {
      const onSend = mock(async () => true);
      const failure = spyOn(toast, "error").mockImplementation(() => "failure");
      const { container, unmount } = render(
        <AgentChatComposer
          settings={{ ...DEFAULT_CHAT_SETTINGS, steerMessagesByDefault }}
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
        if (steerMessagesByDefault) fireEvent.keyDown(getEditorRoot(container), { key: "Enter" });
        else pressAlternateShortcut(container);
        expect(failure).toHaveBeenCalledWith("Cannot steer this message", {
          description: "OpenCode 1.0.0 cannot steer running work.",
        });
        expect(onSend).not.toHaveBeenCalled();
        expect(getEditorRoot(container).textContent).toBe("change course");
      } finally {
        unmount();
        failure.mockRestore();
      }
    },
  );

  test.each([false, true])(
    "maps Enter, Send, and the alternate shortcut with default steering %s",
    async (steerMessagesByDefault) => {
      const onSend = mock(
        async (_draft: AgentChatComposerDraft, _mode: AgentMessageSubmitMode) => true,
      );
      const { container, unmount } = render(
        <AgentChatComposer
          settings={{ ...DEFAULT_CHAT_SETTINGS, steerMessagesByDefault }}
          model={{ ...buildModel(), isSessionWorking: true, onSend }}
        />,
      );
      try {
        for (const [index, action] of ["enter", "button", "alternate"].entries()) {
          typeIntoComposer(container, `message ${index}`);
          if (action === "enter") fireEvent.keyDown(getEditorRoot(container), { key: "Enter" });
          else if (action === "button")
            fireEvent.click(screen.getByRole("button", { name: "Send message" }));
          else pressAlternateShortcut(container);
          await waitFor(() => expect(onSend).toHaveBeenCalledTimes(index + 1));
        }
        expect(onSend.mock.calls.map(([, mode]) => mode)).toEqual(
          steerMessagesByDefault ? ["steer", "steer", "default"] : ["default", "default", "steer"],
        );
      } finally {
        unmount();
      }
    },
  );

  test("applies saved settings to an existing draft without remounting", async () => {
    const onSend = mock(
      async (_draft: AgentChatComposerDraft, _mode: AgentMessageSubmitMode) => true,
    );
    const model = { ...buildModel(), isSessionWorking: true, onSend };
    const { container, rerender, unmount } = render(<AgentChatComposer model={model} />);
    try {
      typeIntoComposer(container, "keep this draft");
      rerender(
        <AgentChatComposer
          settings={{ ...DEFAULT_CHAT_SETTINGS, steerMessagesByDefault: true }}
          model={model}
        />,
      );
      expect(getEditorRoot(container).textContent).toBe("keep this draft");
      fireEvent.keyDown(getEditorRoot(container), { key: "Enter" });
      await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
      const [draft, mode] = onSend.mock.calls[0]!;
      expect(draftToSerializedText(draft)).toBe("keep this draft");
      expect(mode).toBe("steer");
    } finally {
      unmount();
    }
  });

  test("blocks new messages until settings load while Stop stays available", () => {
    const onSend = mock(async () => true);
    const onStopSession = mock(() => {});
    const { container, unmount } = render(
      <AgentChatComposer
        settings={null}
        model={{
          ...buildModel(),
          isSessionWorking: true,
          canStopSession: true,
          onSend,
          onStopSession,
        }}
      />,
    );
    try {
      typeIntoComposer(container, "keep this draft");
      fireEvent.keyDown(getEditorRoot(container), { key: "Enter" });
      pressAlternateShortcut(container);
      expect(screen.getByRole("button", { name: "Send message" }).hasAttribute("disabled")).toBe(
        true,
      );
      fireEvent.click(screen.getByRole("button", { name: "Stop session" }));
      expect(onStopSession).toHaveBeenCalledTimes(1);
      expect(onSend).not.toHaveBeenCalled();
      expect(getEditorRoot(container).textContent).toBe("keep this draft");
    } finally {
      unmount();
    }
  });

  test("checks a primary steer against the running model and allows the ordinary shortcut", async () => {
    const selectedModel: AgentModelCatalog["models"][number] = {
      id: "openai/pdf",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "pdf",
      modelName: "PDF",
      variants: [],
      attachmentSupport: { image: false, audio: false, video: false, pdf: true },
    };
    const onSend = mock(
      async (_draft: AgentChatComposerDraft, _mode: AgentMessageSubmitMode) => true,
    );
    const failure = spyOn(toast, "error").mockImplementation(() => "failure");
    const { container, unmount } = render(
      <AgentChatComposer
        settings={{ ...DEFAULT_CHAT_SETTINGS, steerMessagesByDefault: true }}
        model={{
          ...buildModel(),
          isSessionWorking: true,
          selectedModelDescriptor: selectedModel,
          runningTurnModel: {
            ...selectedModel,
            attachmentSupport: { image: false, audio: false, video: false, pdf: false },
          },
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
      typeIntoComposer(container, "read the brief");
      expect(screen.getByRole("button", { name: "Send message" }).hasAttribute("disabled")).toBe(
        true,
      );
      fireEvent.keyDown(getEditorRoot(container), { key: "Enter" });
      expect(onSend).not.toHaveBeenCalled();
      expect(failure).toHaveBeenCalledWith("Cannot steer this message", {
        description: "brief.pdf: The model of the running turn does not support pdf attachments.",
      });
      expect(getEditorRoot(container).textContent).toBe("read the brief");
      pressAlternateShortcut(container);
      await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
      expect(onSend.mock.calls[0]?.[1]).toBe("default");
    } finally {
      unmount();
      failure.mockRestore();
    }
  });
});
