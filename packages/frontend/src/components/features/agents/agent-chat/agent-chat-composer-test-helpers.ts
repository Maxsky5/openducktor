import { fireEvent } from "@testing-library/react";
import { createRef } from "react";
import { buildModelSelection } from "./agent-chat-test-fixtures";

export const buildModel = () => ({
  displayedSessionKey: "session-1",
  isInteractionEnabled: true,
  isReadOnly: false,
  readOnlyReason: null,
  busySendBlockedReason: null,
  draftScope: {
    key: "draft-1",
    persistence: null,
  },
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
  retrySlashCommands: null,
  retrySkills: null,
  retrySubagents: null,
  onAgentSelectorOpen: () => {},
  onVariantSelectorOpen: () => {},
  onCatalogMenuOpen: () => {},
  searchFiles: async () => [],
  agentOptions: [{ value: "Hephaestus (Deep Agent)", label: "Hephaestus (Deep Agent)" }],
  modelPicker: {
    runtimes: [],
    value: { runtimeKind: "opencode" as const, providerId: "openai", modelId: "gpt-5" },
    selectionPolicy: { kind: "editable" as const },
    favoriteState: {
      favorites: [],
      isLoading: false,
      readError: null,
      isMutationPending: false,
      mutationError: null,
      canMutate: true,
      toggleFavorite: () => {},
      retryRead: () => {},
      retryMutation: () => {},
    },
    onValueChange: () => {},
    onOpenChange: () => {},
  },
  variantOptions: [{ value: "high", label: "high" }],
  onSelectAgent: SHARED_CALLBACKS.onSelectAgent,
  onSelectVariant: SHARED_CALLBACKS.onSelectVariant,
  accentColor: undefined,
  contextUsage: null,
  canStopSession: false,
  isResumingSession: false,
  onStopSession: SHARED_CALLBACKS.onStopSession,
  composerFormRef: createRef<HTMLFormElement>(),
  composerEditorRef: createRef<HTMLDivElement>(),
  onComposerEditorInput: SHARED_CALLBACKS.onComposerEditorInput,
  scrollToBottomOnSendRef: { current: null } satisfies { current: (() => void) | null },
});

type TestStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

export const createMemoryStorage = (spies?: { getItem?: (key: string) => void }): TestStorage => {
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

export const typeIntoComposer = (container: HTMLElement, value: string): void => {
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

const SHARED_CALLBACKS = {
  onSend: async () => true,
  onSelectAgent: () => {},
  onSelectVariant: () => {},
  onStopSession: () => {},
  onComposerEditorInput: () => {},
};

const getLastTextSegment = (container: HTMLElement): HTMLElement => {
  const textSegments = Array.from(container.querySelectorAll("[data-text-segment-id]"));
  const editable = textSegments.at(-1);
  if (!(editable instanceof HTMLElement)) {
    throw new Error("Expected editable composer text segment");
  }

  return editable;
};
