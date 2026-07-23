import { afterEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { AgentChatComposer } from "./agent-chat-composer";
import {
  type AgentChatDraftSessionIdentity,
  toAgentChatDraftStorageKey,
  writeAgentChatDraftToStorage,
} from "./agent-chat-draft-storage";
import {
  flushAgentChatDraft,
  resetAgentChatDraftStoreForTests,
  setAgentChatDraftAttachmentStagerForTests,
  setAgentChatDraftStorageForTests,
} from "./agent-chat-draft-store";
import { buildModelSelection } from "./agent-chat-test-fixtures";

type TestStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

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
  displayedSessionKey: "session-1",
  isInteractionEnabled: true,
  isReadOnly: false,
  readOnlyReason: null,
  busySendBlockedReason: null,
  pendingInlineCommentCount: 0,
  draftStateKey: "draft-1",
  draftPersistenceIdentity: null,
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
  supportsAttachments: true,
  supportsSlashCommands: true,
  supportsFileSearch: true,
  supportsSkillReferences: false,
  supportsSubagentReferences: false,
  slashCommandCatalog: { commands: [] },
  slashCommands: [],
  slashCommandsError: null,
  isSlashCommandsLoading: false,
  skillCatalog: null,
  skills: [],
  skillsError: null,
  isSkillsLoading: false,
  subagentCatalog: null,
  subagents: [],
  subagentsError: null,
  isSubagentsLoading: false,
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
  accentColor: undefined,
  contextUsage: null,
  canStopSession: false,
  onStopSession: SHARED_CALLBACKS.onStopSession,
  composerFormRef: createRef<HTMLFormElement>(),
  composerEditorRef: createRef<HTMLDivElement>(),
  onComposerEditorInput: SHARED_CALLBACKS.onComposerEditorInput,
  scrollToBottomOnSendRef: { current: null } as { current: (() => void) | null },
  syncBottomAfterComposerLayoutRef: { current: null } as { current: (() => void) | null },
});

const createMemoryStorage = (spies?: { getItem?: (key: string) => void }): TestStorage => {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    getItem: (key) => {
      spies?.getItem?.(key);
      return store.get(key) ?? null;
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
};

const sessionIdentity = (
  externalSessionId: string,
  workingDirectory = "/repo",
): AgentChatDraftSessionIdentity => ({
  workspaceId: "workspace-repo",
  externalSessionId,
  runtimeKind: "opencode",
  workingDirectory,
});

const createDeferred = <T,>() => {
  let resolve: ((value: T) => void) | null = null;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return {
    promise,
    resolve: (value: T) => resolve?.(value),
  };
};

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
  afterEach(() => {
    resetAgentChatDraftStoreForTests();
  });

  test("restores independent in-memory drafts when switching sessions", async () => {
    const storage = createMemoryStorage();
    setAgentChatDraftStorageForTests(storage);
    const sessionA = sessionIdentity("session-shared", "/repo-a");
    const sessionB = sessionIdentity("session-shared", "/repo-b");
    const { container, rerender } = render(
      <AgentChatComposer
        model={{
          ...buildModel(),
          displayedSessionKey: "session-a",
          draftStateKey: "draft-a",
          draftPersistenceIdentity: sessionA,
        }}
      />,
    );

    typeIntoComposer(container, "hello A");
    rerender(
      <AgentChatComposer
        model={{
          ...buildModel(),
          displayedSessionKey: "session-b",
          draftStateKey: "draft-b",
          draftPersistenceIdentity: sessionB,
        }}
      />,
    );
    await waitFor(() => {
      expect(container.textContent).not.toContain("hello A");
    });

    typeIntoComposer(container, "hello B");
    rerender(
      <AgentChatComposer
        model={{
          ...buildModel(),
          displayedSessionKey: "session-a",
          draftStateKey: "draft-a",
          draftPersistenceIdentity: sessionA,
        }}
      />,
    );

    await waitFor(() => {
      expect(container.textContent).toContain("hello A");
    });
    expect(container.textContent).not.toContain("hello B");
  });

  test("does not reread localStorage after a session has hydrated into memory", async () => {
    const getItem = mock((_key: string) => {});
    const storage = createMemoryStorage({ getItem });
    setAgentChatDraftStorageForTests(storage);
    const sessionA = sessionIdentity("session-a");
    const sessionB = sessionIdentity("session-b");

    const { rerender } = render(
      <AgentChatComposer
        model={{
          ...buildModel(),
          displayedSessionKey: "session-a",
          draftStateKey: "draft-a",
          draftPersistenceIdentity: sessionA,
        }}
      />,
    );
    rerender(
      <AgentChatComposer
        model={{
          ...buildModel(),
          displayedSessionKey: "session-b",
          draftStateKey: "draft-b",
          draftPersistenceIdentity: sessionB,
        }}
      />,
    );
    rerender(
      <AgentChatComposer
        model={{
          ...buildModel(),
          displayedSessionKey: "session-a",
          draftStateKey: "draft-a",
          draftPersistenceIdentity: sessionA,
        }}
      />,
    );

    await waitFor(() => {
      const sessionAReads = getItem.mock.calls.filter(
        ([key]) => key === toAgentChatDraftStorageKey(sessionA),
      );
      expect(sessionAReads).toHaveLength(1);
    });
  });

  test("restores a persisted draft when the selected session loads", async () => {
    const storage = createMemoryStorage();
    const identity = sessionIdentity("session-a");
    setAgentChatDraftStorageForTests(storage);
    writeAgentChatDraftToStorage({
      storage,
      identity,
      taskId: "task-1",
      draft: { segments: [{ id: "text-1", kind: "text", text: "restored" }], attachments: [] },
      updatedAt: new Date().toISOString(),
    });

    const { container } = render(
      <AgentChatComposer
        model={{
          ...buildModel(),
          displayedSessionKey: "session-a",
          draftStateKey: "draft-a",
          draftPersistenceIdentity: identity,
        }}
      />,
    );

    await waitFor(() => {
      expect(container.textContent).toContain("restored");
    });
  });

  test("clears the submitted session draft after a successful send", async () => {
    const storage = createMemoryStorage();
    const identity = sessionIdentity("session-a");
    const onSend = mock(async () => true);
    setAgentChatDraftStorageForTests(storage);
    const { container } = render(
      <AgentChatComposer
        model={{
          ...buildModel(),
          onSend,
          displayedSessionKey: "session-a",
          draftStateKey: "draft-a",
          draftPersistenceIdentity: identity,
        }}
      />,
    );

    typeIntoComposer(container, "send me");
    await flushAgentChatDraft(identity);
    expect(storage.getItem(toAgentChatDraftStorageKey(identity))).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
      expect(storage.getItem(toAgentChatDraftStorageKey(identity))).toBeNull();
    });
  });

  test("clears a successfully sent attachment draft when staging resolves during send", async () => {
    const storage = createMemoryStorage();
    const identity = sessionIdentity("session-a");
    const stagedPath = createDeferred<string>();
    const sendResult = createDeferred<boolean>();
    const onSend = mock(() => sendResult.promise);
    const file = new File(["pdf"], "brief.pdf", { type: "application/pdf" });
    setAgentChatDraftStorageForTests(storage);
    setAgentChatDraftAttachmentStagerForTests(mock(() => stagedPath.promise));
    const { container } = render(
      <AgentChatComposer
        model={{
          ...buildModel(),
          onSend,
          displayedSessionKey: "session-a",
          draftStateKey: "draft-a",
          draftPersistenceIdentity: identity,
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

    const attachmentInput = container.querySelector('input[type="file"]');
    if (!(attachmentInput instanceof HTMLInputElement)) {
      throw new Error("Expected hidden attachment input");
    }
    fireEvent.change(attachmentInput, {
      target: { files: [file] },
    });
    typeIntoComposer(container, "send with attachment");
    const flushPromise = flushAgentChatDraft(identity);

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });

    stagedPath.resolve("/tmp/staged/brief.pdf");
    await flushPromise;
    expect(storage.getItem(toAgentChatDraftStorageKey(identity))).toContain(
      "/tmp/staged/brief.pdf",
    );

    sendResult.resolve(true);

    await waitFor(() => {
      expect(storage.getItem(toAgentChatDraftStorageKey(identity))).toBeNull();
    });
  });

  test("restores the submitted draft when send returns false", async () => {
    let resolveSend: (didSend: boolean) => void = () => {};
    const onSend = mock(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const storage = createMemoryStorage();
    const identity = sessionIdentity("session-a");
    setAgentChatDraftStorageForTests(storage);
    const { container } = render(
      <AgentChatComposer
        model={{
          ...buildModel(),
          onSend,
          displayedSessionKey: "session-a",
          draftStateKey: "draft-a",
          draftPersistenceIdentity: identity,
        }}
      />,
    );

    typeIntoComposer(container, "keep me");
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => {
      expect(container.textContent).not.toContain("keep me");
    });

    resolveSend(false);

    await waitFor(() => {
      expect(container.textContent).toContain("keep me");
    });
  });

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

  test("disables attachment intake when the runtime does not support attachments", async () => {
    const file = new File(["pdf"], "brief.pdf", { type: "application/pdf" });
    const { container } = render(
      <AgentChatComposer
        model={{
          ...buildModel(),
          supportsAttachments: false,
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Add attachment" }).hasAttribute("disabled")).toBe(
      true,
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

  test("does not restore a failed send draft after the draft key changes", async () => {
    let resolveSend: (didSend: boolean) => void = () => {};
    const onSend = mock(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const initialModel = {
      ...buildModel(),
      onSend,
    };
    const { container, rerender } = render(<AgentChatComposer model={initialModel} />);

    typeIntoComposer(container, "old session draft");
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSend).toHaveBeenCalledTimes(1);
    rerender(
      <AgentChatComposer
        model={{
          ...initialModel,
          draftStateKey: "draft-2",
          displayedSessionKey: "session-2",
        }}
      />,
    );
    resolveSend?.(false);

    await waitFor(() => {
      expect(container.textContent).not.toContain("old session draft");
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
