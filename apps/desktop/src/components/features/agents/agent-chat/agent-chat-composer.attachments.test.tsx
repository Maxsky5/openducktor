import { describe, expect, test } from "bun:test";
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
});
