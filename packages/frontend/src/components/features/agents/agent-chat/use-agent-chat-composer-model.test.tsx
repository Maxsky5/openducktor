import { describe, expect, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import { act, createRef } from "react";
import { useInlineCommentDraftStore } from "@/state/use-inline-comment-draft-store";
import { draftToSerializedText } from "./agent-chat-composer-draft";
import { buildModelSelection, createComposerDraft } from "./agent-chat-test-fixtures";
import {
  type AgentChatComposerConfig,
  useAgentChatComposerModel,
} from "./use-agent-chat-composer-model";

const buildComposerConfig = (
  onSend: AgentChatComposerConfig["onSend"],
): AgentChatComposerConfig => ({
  displayedSessionKey: null,
  selectedSession: null,
  isSessionModelCatalogLoading: false,
  isSessionWorking: false,
  isWaitingInput: false,
  waitingInputPlaceholder: null,
  busySendBlockedReason: null,
  canStopSession: false,
  stopAgentSession: async () => {},
  isReadOnly: false,
  readOnlyReason: null,
  draftScope: {
    key: "task-1:build:new",
    persistence: null,
  },
  onSend,
  isSending: false,
  isStarting: false,
  contextUsage: null,
  selectedModelSelection: buildModelSelection(),
  isSelectionCatalogLoading: false,
  supportsAttachments: false,
  supportsSlashCommands: false,
  supportsFileSearch: false,
  supportsSkillReferences: false,
  supportsSubagentReferences: false,
  slashCommandCatalog: null,
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
  agentOptions: [],
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
  variantOptions: [],
  onSelectAgent: () => {},
  onSelectVariant: () => {},
});

describe("useAgentChatComposerModel", () => {
  test("forwards only the caller draft when stale task review comments exist without an adapter", async () => {
    const previousState = useInlineCommentDraftStore.getState();
    const previousDrafts = previousState.drafts;
    const previousDraftStateKey = previousState.draftStateKey;
    useInlineCommentDraftStore.setState({
      draftStateKey: "task-1:build:new",
      drafts: [
        {
          id: "stale-review-comment",
          filePath: "packages/frontend/src/stale.ts",
          diffScope: "uncommitted",
          startLine: 1,
          endLine: 1,
          side: "new",
          text: "This must not join the shared chat send.",
          codeContext: [{ lineNumber: 1, text: "const stale = true;", isSelected: true }],
          language: "ts",
          revision: 1,
          submissionId: null,
          createdAt: 1,
          updatedAt: 1,
          status: "pending",
        },
      ],
    });
    // SAFETY: This test controls the fixture and supplies `string | null` used by this case.
    const sentDraft = { text: null as string | null };
    const callerDraft = createComposerDraft("Repository-only question");
    const composerFormRef = createRef<HTMLFormElement>();
    const composerEditorRef = createRef<HTMLDivElement>();
    // SAFETY: This test controls the fixture and supplies `(() => void) | null` used by this case.
    const scrollToBottomOnSendRef = { current: null as (() => void) | null };
    // SAFETY: This test controls the fixture and supplies `(() => void) | null` used by this case.
    const syncBottomAfterComposerLayoutRef = { current: null as (() => void) | null };
    const rendered = renderHook(() =>
      useAgentChatComposerModel({
        composer: buildComposerConfig(async (draft) => {
          sentDraft.text = draftToSerializedText(draft);
          return true;
        }),
        interactionEnabled: true,
        sessionAgentColors: {},
        composerFormRef,
        composerEditorRef,
        resizeComposerEditor: () => {},
        scrollToBottomOnSendRef,
        syncBottomAfterComposerLayoutRef,
      }),
    );

    try {
      await act(async () => {
        const composerModel = rendered.result.current;
        if (!composerModel) {
          throw new Error("Expected a shared composer model.");
        }
        await composerModel.onSend(callerDraft);
      });

      expect(sentDraft.text).toBe("Repository-only question");
      expect(useInlineCommentDraftStore.getState().drafts).toHaveLength(1);
    } finally {
      rendered.unmount();
      useInlineCommentDraftStore.setState({
        drafts: previousDrafts,
        draftStateKey: previousDraftStateKey,
      });
    }
  });
});
