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
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { getAgentSessionWaitingInputPlaceholder } from "@/lib/agent-session-waiting-input";
import { useInlineCommentDraftStore } from "@/state/use-inline-comment-draft-store";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { resolveAgentSessionAccentColor } from "../agent-accent-color";
import type { AgentChatComposerModel, AgentChatThreadRuntimeReadiness } from "./agent-chat.types";
import { type AgentChatComposerDraft, appendTextToDraft } from "./agent-chat-composer-draft";

const parseDraftStateKey = (draftStateKey: string) => {
  const [taskId = "", role = "", sessionKey = ""] = draftStateKey.split(":");
  return { taskId, role, sessionKey };
};

const isSessionOnlyDraftStateTransition = (previousKey: string, nextKey: string): boolean => {
  const previous = parseDraftStateKey(previousKey);
  const next = parseDraftStateKey(nextKey);
  return (
    previous.taskId === next.taskId &&
    previous.role === next.role &&
    previous.sessionKey !== next.sessionKey
  );
};

type StopAgentSession = (session: AgentSessionIdentity) => Promise<void>;

type ComposerActiveSession = AgentSessionIdentity &
  Pick<AgentSessionState, "selectedModel" | "pendingApprovals" | "pendingQuestions"> & {
    isLoadingModelCatalog: boolean;
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
  activeSession: ComposerActiveSession | null;
  isSessionWorking: boolean;
  isWaitingInput: boolean;
  busySendBlockedReason: string | null;
  canStopSession: boolean;
  stopAgentSession: StopAgentSession;
  isReadOnly: boolean;
  readOnlyReason: string | null;
  draftStateKey: string;
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
  supportsSlashCommands: boolean;
  supportsFileSearch: boolean;
  supportsSkillReferences: boolean;
  slashCommandCatalog: AgentChatComposerModel["slashCommandCatalog"];
  slashCommands: AgentChatComposerModel["slashCommands"];
  slashCommandsError: string | null;
  isSlashCommandsLoading: boolean;
  skillCatalog: AgentChatComposerModel["skillCatalog"];
  skills: AgentChatComposerModel["skills"];
  skillsError: string | null;
  isSkillsLoading: boolean;
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
  runtimeReadiness: AgentChatThreadRuntimeReadiness;
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
  const previousDraftStateKeyRef = useRef<string | null>(null);
  const composerDraftStateKey = composer?.draftStateKey ?? null;

  useEffect(() => {
    if (!composerDraftStateKey) {
      return;
    }
    const store = useInlineCommentDraftStore.getState();
    const previousDraftStateKey = previousDraftStateKeyRef.current;
    if (previousDraftStateKey === composerDraftStateKey) {
      return;
    }

    if (
      previousDraftStateKey != null &&
      isSessionOnlyDraftStateTransition(previousDraftStateKey, composerDraftStateKey) &&
      store.drafts.some((draft) => draft.status === "submitting")
    ) {
      store.setDraftStateKey(composerDraftStateKey);
    } else {
      store.resetForContext(composerDraftStateKey);
    }

    previousDraftStateKeyRef.current = composerDraftStateKey;
  }, [composerDraftStateKey]);

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

  const waitingInputPlaceholder = composer?.activeSession
    ? getAgentSessionWaitingInputPlaceholder(composer.activeSession)
    : null;
  const composerRuntimeKind =
    composer?.activeSession?.runtimeKind ?? composer?.selectedModelSelection?.runtimeKind ?? null;
  const composerAccentAgentName = composer?.activeSession
    ? composer.activeSession.selectedModel?.profileId
    : composer?.selectedModelSelection?.profileId;
  const composerAccentColor = useMemo(
    () =>
      resolveAgentSessionAccentColor({
        agentName: composerAccentAgentName,
        agentColors: sessionAgentColors,
        runtimeKind: composerRuntimeKind,
      }),
    [composerAccentAgentName, composerRuntimeKind, sessionAgentColors],
  );

  return useMemo(() => {
    if (!composer) {
      return undefined;
    }

    const isModelSelectionPending = Boolean(
      composer.activeSession?.isLoadingModelCatalog && !composer.activeSession.selectedModel,
    );
    const displayedSessionKey = composer.activeSession
      ? agentSessionIdentityKey(composer.activeSession)
      : null;
    const isComposerInteractionEnabled = runtimeReadiness.isReady;

    return {
      taskId: composer.taskId,
      displayedSessionKey,
      isInteractionEnabled: isComposerInteractionEnabled,
      isReadOnly: composer.isReadOnly,
      readOnlyReason: composer.readOnlyReason,
      busySendBlockedReason: composer.busySendBlockedReason,
      pendingInlineCommentCount,
      draftStateKey: composer.draftStateKey,
      onSend: (draft) => submitComposerDraft(draft, composer.onSend),
      isSending: composer.isSending,
      isStarting: composer.isStarting,
      isSessionWorking: composer.isSessionWorking,
      isWaitingInput: composer.isWaitingInput,
      waitingInputPlaceholder,
      isModelSelectionPending,
      selectedModelSelection: composer.selectedModelSelection,
      ...(composer.selectedModelDescriptor !== undefined
        ? { selectedModelDescriptor: composer.selectedModelDescriptor }
        : {}),
      isSelectionCatalogLoading: composer.isSelectionCatalogLoading,
      ...(composer.supportsProfiles !== undefined
        ? { supportsProfiles: composer.supportsProfiles }
        : {}),
      supportsSlashCommands: composer.supportsSlashCommands,
      supportsFileSearch: composer.supportsFileSearch,
      supportsSkillReferences: composer.supportsSkillReferences,
      slashCommandCatalog: composer.slashCommandCatalog,
      slashCommands: composer.slashCommands,
      slashCommandsError: composer.slashCommandsError,
      isSlashCommandsLoading: composer.isSlashCommandsLoading,
      skillCatalog: composer.skillCatalog,
      skills: composer.skills,
      skillsError: composer.skillsError,
      isSkillsLoading: composer.isSkillsLoading,
      searchFiles: composer.searchFiles,
      agentOptions: composer.agentOptions,
      modelOptions: composer.modelOptions,
      modelGroups: composer.modelGroups,
      variantOptions: composer.variantOptions,
      onSelectAgent: composer.onSelectAgent,
      onSelectModel: composer.onSelectModel,
      onSelectVariant: composer.onSelectVariant,
      accentColor: composerAccentColor,
      contextUsage: composer.contextUsage,
      canStopSession: composer.canStopSession,
      onStopSession: () =>
        invokeStopAgentSession(composer.activeSession, composer.stopAgentSession),
      composerFormRef,
      composerEditorRef,
      onComposerEditorInput: resizeComposerEditor,
      scrollToBottomOnSendRef,
      syncBottomAfterComposerLayoutRef,
    };
  }, [
    composer,
    composerAccentColor,
    composerEditorRef,
    composerFormRef,
    pendingInlineCommentCount,
    resizeComposerEditor,
    runtimeReadiness.isReady,
    scrollToBottomOnSendRef,
    submitComposerDraft,
    syncBottomAfterComposerLayoutRef,
    waitingInputPlaceholder,
  ]);
}
