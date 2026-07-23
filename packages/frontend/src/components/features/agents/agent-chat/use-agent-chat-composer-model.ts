import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentModelSelection,
} from "@openducktor/core";
import {
  type MutableRefObject,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import type { RepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import { useInlineCommentDraftStore } from "@/state/use-inline-comment-draft-store";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { AgentChatComposerModel } from "./agent-chat.types";
import { type AgentChatComposerDraft, appendTextToDraft } from "./agent-chat-composer-draft";
import { deriveAgentChatComposerModelState } from "./agent-chat-composer-model-state";
import {
  type AgentChatDraftScope,
  didAgentChatDraftScopeSwitchSessionOnly,
} from "./agent-chat-draft-scope";
import type { AgentChatDraftSessionIdentity } from "./agent-chat-draft-storage";

type StopAgentSession = (session: AgentSessionIdentity) => Promise<void>;
type AgentChatComposerSelectedSession = AgentSessionIdentity & {
  selectedModel: AgentModelSelection | null;
};

export const invokeStopAgentSession = (
  session: AgentSessionIdentity | null,
  stopAgentSession: StopAgentSession | undefined,
): void => {
  if (!session || !stopAgentSession) {
    return;
  }
  void stopAgentSession(session).catch(() => undefined);
};

export type AgentChatComposerConfig = {
  taskId: string;
  displayedSessionKey: string | null;
  selectedSession: AgentChatComposerSelectedSession | null;
  isSessionModelCatalogLoading: boolean;
  isSessionWorking: boolean;
  isWaitingInput: boolean;
  waitingInputPlaceholder: string | null;
  busySendBlockedReason: string | null;
  canStopSession: boolean;
  stopAgentSession: StopAgentSession;
  isReadOnly: boolean;
  readOnlyReason: string | null;
  draftStateKey: string;
  draftScope: AgentChatDraftScope;
  draftPersistenceIdentity: AgentChatDraftSessionIdentity | null;
  onSend: (draft: AgentChatComposerDraft) => Promise<boolean>;
  isSending: boolean;
  isStarting: boolean;
  contextUsage: {
    totalTokens: number;
    contextWindow: number;
    outputLimit?: number;
  } | null;
  selectedModelSelection: AgentModelSelection | null;
  selectedModelDescriptor?: AgentModelCatalog["models"][number] | null | undefined;
  isSelectionCatalogLoading: boolean;
  supportsProfiles?: boolean;
  supportsAttachments: boolean;
  supportsSlashCommands: boolean;
  supportsFileSearch: boolean;
  supportsSkillReferences: boolean;
  supportsSubagentReferences: boolean;
  slashCommandCatalog: AgentChatComposerModel["slashCommandCatalog"];
  slashCommands: AgentChatComposerModel["slashCommands"];
  slashCommandsError: string | null;
  isSlashCommandsLoading: boolean;
  skillCatalog: AgentChatComposerModel["skillCatalog"];
  skills: AgentChatComposerModel["skills"];
  skillsError: string | null;
  isSkillsLoading: boolean;
  subagentCatalog: AgentChatComposerModel["subagentCatalog"];
  subagents: AgentChatComposerModel["subagents"];
  subagentsError: string | null;
  isSubagentsLoading: boolean;
  searchFiles: (query: string) => Promise<AgentFileSearchResult[]>;
  agentOptions: ComboboxOption[];
  modelOptions: ComboboxOption[];
  modelGroups: ComboboxGroup[];
  variantOptions: ComboboxOption[];
  onSelectAgent: (agent: string) => void;
  onSelectModel: (model: string) => void;
  onSelectVariant: (variant: string) => void;
};

type UseAgentChatComposerModelArgs = {
  composer: AgentChatComposerConfig | undefined;
  runtimeReadiness: RepoRuntimeReadiness;
  sessionAgentColors: Record<string, string>;
  composerFormRef: RefObject<HTMLFormElement | null>;
  composerEditorRef: RefObject<HTMLDivElement | null>;
  resizeComposerEditor: () => void;
  scrollToBottomOnSendRef: MutableRefObject<(() => void) | null>;
  syncBottomAfterComposerLayoutRef: MutableRefObject<(() => void) | null>;
};

export function useAgentChatComposerModel({
  composer,
  runtimeReadiness,
  sessionAgentColors,
  composerFormRef,
  composerEditorRef,
  resizeComposerEditor,
  scrollToBottomOnSendRef,
  syncBottomAfterComposerLayoutRef,
}: UseAgentChatComposerModelArgs): AgentChatComposerModel | undefined {
  const pendingInlineCommentCount = useInlineCommentDraftStore((store) => store.getDraftCount());
  const previousDraftScopeRef = useRef<AgentChatDraftScope | null>(null);
  const composerDraftStateKey = composer?.draftStateKey ?? null;
  const composerDraftScope = composer?.draftScope ?? null;

  useEffect(() => {
    if (!composerDraftStateKey || !composerDraftScope) {
      return;
    }
    const store = useInlineCommentDraftStore.getState();
    const previousDraftScope = previousDraftScopeRef.current;
    if (previousDraftScope === composerDraftScope) {
      return;
    }

    if (
      previousDraftScope != null &&
      didAgentChatDraftScopeSwitchSessionOnly(previousDraftScope, composerDraftScope) &&
      store.drafts.some((draft) => draft.status === "submitting")
    ) {
      store.setDraftStateKey(composerDraftStateKey);
    } else {
      store.resetForContext(composerDraftStateKey);
    }

    previousDraftScopeRef.current = composerDraftScope;
  }, [composerDraftScope, composerDraftStateKey]);

  const submitComposerDraft = useCallback(
    async (
      draft: AgentChatComposerDraft,
      onSend: AgentChatComposerConfig["onSend"],
    ): Promise<boolean> => {
      const pendingDrafts = useInlineCommentDraftStore.getState().getPendingDrafts();
      const submittingDrafts = pendingDrafts.map((pendingDraft) => ({
        id: pendingDraft.id,
        revision: pendingDraft.revision,
      }));
      const commentAppendix = useInlineCommentDraftStore
        .getState()
        .formatBatchMessage(pendingDrafts);
      const nextDraft =
        commentAppendix.length > 0 ? appendTextToDraft(draft, commentAppendix) : draft;
      scrollToBottomOnSendRef.current?.();
      const submissionId = useInlineCommentDraftStore
        .getState()
        .beginSubmittingDrafts(submittingDrafts);
      try {
        const didSend = await onSend(nextDraft);
        if (!submissionId) {
          return didSend;
        }

        if (didSend) {
          useInlineCommentDraftStore.getState().completeSubmittingDrafts(submissionId);
        } else {
          useInlineCommentDraftStore.getState().restoreSubmittingDrafts(submissionId);
        }
        return didSend;
      } catch (error) {
        if (submissionId) {
          useInlineCommentDraftStore.getState().restoreSubmittingDrafts(submissionId);
        }
        throw error;
      }
    },
    [scrollToBottomOnSendRef],
  );

  const isRuntimeReady = runtimeReadiness.state === "ready";
  const composerState = useMemo(
    () =>
      composer
        ? deriveAgentChatComposerModelState({
            selectedSession: composer.selectedSession,
            selectedModelSelection: composer.selectedModelSelection,
            isSessionModelCatalogLoading: composer.isSessionModelCatalogLoading,
            isRuntimeReady,
            sessionAgentColors,
          })
        : null,
    [composer, isRuntimeReady, sessionAgentColors],
  );

  return useMemo(() => {
    if (!composer) {
      return undefined;
    }

    return {
      taskId: composer.taskId,
      displayedSessionKey: composer.displayedSessionKey,
      isInteractionEnabled: composerState?.isInteractionEnabled ?? false,
      isReadOnly: composer.isReadOnly,
      readOnlyReason: composer.readOnlyReason,
      busySendBlockedReason: composer.busySendBlockedReason,
      pendingInlineCommentCount,
      draftStateKey: composer.draftStateKey,
      draftPersistenceIdentity: composer.draftPersistenceIdentity,
      onSend: (draft) => submitComposerDraft(draft, composer.onSend),
      isSending: composer.isSending,
      isStarting: composer.isStarting,
      isSessionWorking: composer.isSessionWorking,
      isWaitingInput: composer.isWaitingInput,
      waitingInputPlaceholder: composer.waitingInputPlaceholder,
      isModelSelectionPending: composerState?.isModelSelectionPending ?? false,
      selectedModelSelection: composer.selectedModelSelection,
      ...(composer.selectedModelDescriptor !== undefined
        ? { selectedModelDescriptor: composer.selectedModelDescriptor }
        : {}),
      isSelectionCatalogLoading: composer.isSelectionCatalogLoading,
      ...(composer.supportsProfiles !== undefined
        ? { supportsProfiles: composer.supportsProfiles }
        : {}),
      supportsAttachments: composer.supportsAttachments,
      supportsSlashCommands: composer.supportsSlashCommands,
      supportsFileSearch: composer.supportsFileSearch,
      supportsSkillReferences: composer.supportsSkillReferences,
      supportsSubagentReferences: composer.supportsSubagentReferences,
      slashCommandCatalog: composer.slashCommandCatalog,
      slashCommands: composer.slashCommands,
      slashCommandsError: composer.slashCommandsError,
      isSlashCommandsLoading: composer.isSlashCommandsLoading,
      skillCatalog: composer.skillCatalog,
      skills: composer.skills,
      skillsError: composer.skillsError,
      isSkillsLoading: composer.isSkillsLoading,
      subagentCatalog: composer.subagentCatalog,
      subagents: composer.subagents,
      subagentsError: composer.subagentsError,
      isSubagentsLoading: composer.isSubagentsLoading,
      searchFiles: composer.searchFiles,
      agentOptions: composer.agentOptions,
      modelOptions: composer.modelOptions,
      modelGroups: composer.modelGroups,
      variantOptions: composer.variantOptions,
      onSelectAgent: composer.onSelectAgent,
      onSelectModel: composer.onSelectModel,
      onSelectVariant: composer.onSelectVariant,
      accentColor: composerState?.accentColor,
      contextUsage: composer.contextUsage,
      canStopSession: composer.canStopSession,
      onStopSession: () =>
        invokeStopAgentSession(composer.selectedSession, composer.stopAgentSession),
      composerFormRef,
      composerEditorRef,
      onComposerEditorInput: resizeComposerEditor,
      scrollToBottomOnSendRef,
      syncBottomAfterComposerLayoutRef,
    };
  }, [
    composer,
    composerState,
    composerEditorRef,
    composerFormRef,
    pendingInlineCommentCount,
    resizeComposerEditor,
    scrollToBottomOnSendRef,
    submitComposerDraft,
    syncBottomAfterComposerLayoutRef,
  ]);
}
