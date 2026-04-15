import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { AgentChatComposer } from "./agent-chat-composer";
import { buildModelSelection } from "./agent-chat-test-fixtures";

const SHARED_CALLBACKS = {
  onSend: async () => true,
  onSelectAgent: () => {},
  onSelectModel: () => {},
  onSelectVariant: () => {},
  onStopSession: () => {},
  onComposerEditorInput: () => {},
};

const buildModel = () => ({
  taskId: "task-1",
  agentStudioReady: true,
  isReadOnly: false,
  readOnlyReason: null,
  busySendBlockedReason: null,
  pendingInlineCommentCount: 0,
  draftStateKey: "draft-1",
  onSend: SHARED_CALLBACKS.onSend,
  isSending: false,
  isStarting: false,
  isSessionWorking: false,
  isWaitingInput: false,
  waitingInputPlaceholder: null,
  isModelSelectionPending: false,
  selectedModelSelection: buildModelSelection(),
  selectedModelDescriptor: null,
  isSelectionCatalogLoading: false,
  supportsSlashCommands: true,
  supportsFileSearch: true,
  slashCommandCatalog: { commands: [] },
  slashCommands: [],
  slashCommandsError: null,
  isSlashCommandsLoading: false,
  searchFiles: async () => [],
  agentOptions: [{ value: "Hephaestus (Deep Agent)", label: "Hephaestus (Deep Agent)" }],
  modelOptions: [{ value: "openai/gpt-5.3-codex", label: "GPT-5.3 Codex" }],
  modelGroups: [
    {
      label: "OpenAI",
      options: [{ value: "openai/gpt-5.3-codex", label: "GPT-5.3 Codex" }],
    },
  ],
  variantOptions: [{ value: "high", label: "high" }],
  onSelectAgent: SHARED_CALLBACKS.onSelectAgent,
  onSelectModel: SHARED_CALLBACKS.onSelectModel,
  onSelectVariant: SHARED_CALLBACKS.onSelectVariant,
  sessionAgentColors: {},
  contextUsage: null,
  canStopSession: false,
  onStopSession: SHARED_CALLBACKS.onStopSession,
  composerFormRef: createRef<HTMLFormElement>(),
  composerEditorRef: createRef<HTMLDivElement>(),
  onComposerEditorInput: SHARED_CALLBACKS.onComposerEditorInput,
  scrollToBottomOnSendRef: { current: null } as { current: (() => void) | null },
  syncBottomAfterComposerLayoutRef: { current: null } as { current: (() => void) | null },
});

const getEditorRoot = (container: HTMLElement): HTMLElement => {
  const editorRoot = container.querySelector('[contenteditable="true"]');
  if (!(editorRoot instanceof HTMLElement)) {
    throw new Error("Expected editable composer root");
  }

  return editorRoot;
};

const getLastTextSegment = (container: HTMLElement): HTMLElement => {
  const textSegments = Array.from(container.querySelectorAll("[data-text-segment-id]"));
  const editable = textSegments.at(-1);
  if (!(editable instanceof HTMLElement)) {
    throw new Error("Expected editable composer text segment");
  }

  return editable;
};

const typeIntoComposer = (container: HTMLElement, value: string): void => {
  const editable = getLastTextSegment(container);
  editable.textContent = value;
  const textNode = editable.firstChild;
  if (textNode) {
    const range = document.createRange();
    range.setStart(textNode, value.length);
    range.collapse(true);
    const selection = globalThis.getSelection?.();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  fireEvent.input(editable);
};

const createClipboardData = ({ itemFile, files }: { itemFile?: File; files?: File[] }) => ({
  items: itemFile
    ? [
        {
          kind: "file",
          type: itemFile.type,
          getAsFile: () => itemFile,
        },
      ]
    : [],
  files: files ?? [],
  types: ["Files"],
  getData: () => "",
});

describe("AgentChatComposer attachments", () => {
  test("stages attachments, revalidates on model changes, and removes them", async () => {
    const file = new File(["pdf"], "brief.pdf", { type: "application/pdf" });
    const { container, rerender } = render(<AgentChatComposer model={buildModel()} />);

    const attachmentInput = container.querySelector('input[type="file"]');
    if (!(attachmentInput instanceof HTMLInputElement)) {
      throw new Error("Expected hidden attachment input");
    }

    fireEvent.change(attachmentInput, {
      target: { files: [file] },
    });

    await screen.findByTitle("brief.pdf");
    expect(
      screen.getByText("The selected model does not expose attachment capability data."),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Send message" }).getAttribute("disabled"),
    ).not.toBeNull();

    rerender(
      <AgentChatComposer
        model={{
          ...buildModel(),
          selectedModelDescriptor: {
            id: "openai/gpt-5.3-codex",
            providerId: "openai",
            providerName: "OpenAI",
            modelId: "gpt-5.3-codex",
            modelName: "GPT-5.3 Codex",
            variants: ["high"],
            contextWindow: 400_000,
            outputLimit: 128_000,
            attachmentSupport: {
              image: false,
              audio: false,
              video: false,
              pdf: true,
            },
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(
        screen.queryByText("The selected model does not expose attachment capability data."),
      ).toBeNull();
    });
    expect(
      screen.getByRole("button", { name: "Send message" }).getAttribute("disabled"),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Remove brief.pdf" }));

    await waitFor(() => {
      expect(screen.queryByTitle("brief.pdf")).toBeNull();
    });
    expect(
      screen.getByRole("button", { name: "Send message" }).getAttribute("disabled"),
    ).not.toBeNull();
  });

  test("ignores attachment intake while the composer is disabled", async () => {
    const file = new File(["pdf"], "brief.pdf", { type: "application/pdf" });
    const { container } = render(
      <AgentChatComposer
        model={{
          ...buildModel(),
          isReadOnly: true,
          readOnlyReason: "Read-only",
        }}
      />,
    );

    const attachmentInput = container.querySelector('input[type="file"]');
    if (!(attachmentInput instanceof HTMLInputElement)) {
      throw new Error("Expected hidden attachment input");
    }

    fireEvent.change(attachmentInput, {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.queryByTitle("brief.pdf")).toBeNull();
    });
  });

  test("requests a bottom resync when attachment layout changes", async () => {
    const syncBottomAfterComposerLayout = { current: mock(() => {}) };
    const file = new File(["pdf"], "brief.pdf", { type: "application/pdf" });
    const { container } = render(
      <AgentChatComposer
        model={{
          ...buildModel(),
          syncBottomAfterComposerLayoutRef: syncBottomAfterComposerLayout,
        }}
      />,
    );

    const attachmentInput = container.querySelector('input[type="file"]');
    if (!(attachmentInput instanceof HTMLInputElement)) {
      throw new Error("Expected hidden attachment input");
    }

    fireEvent.change(attachmentInput, {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(syncBottomAfterComposerLayout.current).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove brief.pdf" }));

    await waitFor(() => {
      expect(syncBottomAfterComposerLayout.current).toHaveBeenCalledTimes(2);
    });
  });

  test("pastes unnamed images as attachments without disturbing existing text", async () => {
    const { container } = render(
      <AgentChatComposer
        model={{
          ...buildModel(),
          selectedModelDescriptor: {
            id: "openai/gpt-5.3-codex",
            providerId: "openai",
            providerName: "OpenAI",
            modelId: "gpt-5.3-codex",
            modelName: "GPT-5.3 Codex",
            variants: ["high"],
            contextWindow: 400_000,
            outputLimit: 128_000,
            attachmentSupport: {
              image: true,
              audio: false,
              video: false,
              pdf: true,
            },
          },
        }}
      />,
    );

    typeIntoComposer(container, "existing text");
    const unnamedImage = new File(["image"], "", { type: "image/png" });

    fireEvent.paste(getEditorRoot(container), {
      clipboardData: createClipboardData({ itemFile: unnamedImage }),
    });

    await screen.findByTitle("pasted-image.png");
    expect(screen.getByRole("button", { name: "Remove pasted-image.png" })).toBeDefined();
    const contentRoot = container.querySelector("[data-composer-content-root]");
    expect(contentRoot?.textContent).toContain("existing text");
  });

  test("shows existing attachment validation errors for pasted images", async () => {
    const { container } = render(
      <AgentChatComposer
        model={{
          ...buildModel(),
          selectedModelDescriptor: {
            id: "openai/gpt-5.3-codex",
            providerId: "openai",
            providerName: "OpenAI",
            modelId: "gpt-5.3-codex",
            modelName: "GPT-5.3 Codex",
            variants: ["high"],
            contextWindow: 400_000,
            outputLimit: 128_000,
            attachmentSupport: {
              image: false,
              audio: false,
              video: false,
              pdf: true,
            },
          },
        }}
      />,
    );

    fireEvent.paste(getEditorRoot(container), {
      clipboardData: createClipboardData({
        itemFile: new File(["image"], "clipboard-image.png", { type: "image/png" }),
      }),
    });

    await screen.findByTitle("clipboard-image.png");
    expect(
      screen.getByText("The selected model does not support image attachments."),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Send message" }).getAttribute("disabled"),
    ).not.toBeNull();
  });

  test("stages one attachment when the same paste is exposed through items and files", async () => {
    const { container } = render(
      <AgentChatComposer
        model={{
          ...buildModel(),
          selectedModelDescriptor: {
            id: "openai/gpt-5.3-codex",
            providerId: "openai",
            providerName: "OpenAI",
            modelId: "gpt-5.3-codex",
            modelName: "GPT-5.3 Codex",
            variants: ["high"],
            contextWindow: 400_000,
            outputLimit: 128_000,
            attachmentSupport: {
              image: true,
              audio: false,
              video: false,
              pdf: true,
            },
          },
        }}
      />,
    );

    fireEvent.paste(getEditorRoot(container), {
      clipboardData: createClipboardData({
        itemFile: new File(["image"], "image.png", { type: "image/png", lastModified: 1 }),
        files: [new File(["image"], "image.png", { type: "image/png", lastModified: 2 })],
      }),
    });

    await waitFor(() => {
      expect(screen.getAllByTitle("image.png")).toHaveLength(1);
    });
  });
});
