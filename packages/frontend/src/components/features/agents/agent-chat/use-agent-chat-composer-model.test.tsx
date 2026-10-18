import { describe, expect, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import { act, createRef } from "react";
import { toInlineCommentDraftStorageKey } from "@openducktor/frontend-core/drafts/inline-comment-draft-storage";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { QueryProvider } from "@/test-utils/query-provider";
import { draftToSerializedText } from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
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
  steerBlockedReason: null,
  runningTurnModel: null,
  messageQueue: null,
  canStopSession: false,
  isResumingSession: false,
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
  speed: null,
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
  retrySlashCommands: null,
  retrySkills: null,
  retrySubagents: null,
  onAgentSelectorOpen: () => {},
  onVariantSelectorOpen: () => {},
  onCatalogMenuOpen: () => {},
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
    const ownerKey = toInlineCommentDraftStorageKey({
      workspaceId: "workspace-1",
      taskId: "task-1",
    });
    const connection = createTestClientConnection();
    const inlineComments = connection.drafts.inlineComments;
    inlineComments.setState({
      draftsByOwner: {
        [ownerKey]: [
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
      },
    });
    const sentDraftText = createRef<string>();
    const callerDraft = createComposerDraft("Repository-only question");
    const composerFormRef = createRef<HTMLFormElement>();
    const composerEditorRef = createRef<HTMLDivElement>();
    const scrollToBottomOnSendRef = createRef<() => void>();
    const rendered = renderHook(
      () =>
        useAgentChatComposerModel({
          composer: buildComposerConfig(async (draft) => {
            sentDraftText.current = draftToSerializedText(draft);
            return true;
          }),
          interactionEnabled: true,
          composerFormRef,
          composerEditorRef,
          resizeComposerEditor: () => {},
          scrollToBottomOnSendRef,
        }),
      {
        wrapper: ({ children }) => (
          <QueryProvider connection={connection}>{children}</QueryProvider>
        ),
      },
    );

    try {
      await act(async () => {
        const composerModel = rendered.result.current;
        if (!composerModel) {
          throw new Error("Expected a shared composer model.");
        }
        await composerModel.onSend(callerDraft, "default");
      });

      expect(sentDraftText.current).toBe("Repository-only question");
      expect(inlineComments.getState().draftsByOwner[ownerKey]).toHaveLength(1);
    } finally {
      rendered.unmount();
      await connection.dispose();
    }
  });
});
