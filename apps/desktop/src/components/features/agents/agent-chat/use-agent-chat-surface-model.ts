import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentModelSelection,
} from "@openducktor/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import { getAgentSessionWaitingInputPlaceholder } from "@/lib/agent-session-waiting-input";
import { useInlineCommentDraftStore } from "@/state/use-inline-comment-draft-store";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { resolveAgentAccentColor } from "../agent-accent-color";
import type {
  AgentChatComposerModel,
  AgentChatEmptyStateModel,
  AgentChatMode,
  AgentChatSurfaceModel,
} from "./agent-chat.types";
import { type AgentChatComposerDraft, appendTextToDraft } from "./agent-chat-composer-draft";
import { useAgentChatLayout } from "./use-agent-chat-layout";
import { useAgentChatThreadContext } from "./use-agent-chat-thread-context";

const parseDraftStateKey = (draftStateKey: string) => {
  const [taskId = "", role = "", sessionId = "", contextSwitchVersion = ""] =
    draftStateKey.split(":");
  return { taskId, role, sessionId, contextSwitchVersion };
};

const isSessionOnlyDraftStateTransition = (previousKey: string, nextKey: string): boolean => {
  const previous = parseDraftStateKey(previousKey);
  const next = parseDraftStateKey(nextKey);
  return (
    previous.taskId === next.taskId &&
    previous.role === next.role &&
    previous.contextSwitchVersion === next.contextSwitchVersion &&
    previous.sessionId !== next.sessionId
  );
};

const buildSessionAgentColors = (
  catalog: AgentModelCatalog | null | undefined,
): Record<string, string> => {
  if (!catalog) {
    return {};
  }

  const map: Record<string, string> = {};
  for (const descriptor of catalog.profiles ?? []) {
    const descriptorId = descriptor.id ?? descriptor.name;
    const descriptorLabel = descriptor.label ?? descriptor.name;
    if (!descriptorId || !descriptorLabel) {
      continue;
    }
    const color = resolveAgentAccentColor(descriptorLabel, descriptor.color);
    if (color) {
      map[descriptorId] = color;
    }
  }
  return map;
};

const missingInteractiveComposerAction = (): never => {
  throw new Error("Interactive composer action is unavailable.");
};

const missingInteractiveComposerFileSearch = async (): Promise<AgentFileSearchResult[]> => {
  throw new Error("Interactive composer file search is unavailable.");
};

type AgentChatRuntimeReadiness = {
  readinessState: "ready" | "checking" | "blocked";
  isReady: boolean;
  blockedReason: string | null;
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
};

type AgentChatPendingQuestionActions = {
  canSubmit: boolean;
  isSubmittingByRequestId: Record<string, boolean>;
  onSubmit: (requestId: string, answers: string[][]) => Promise<void>;
};

type AgentChatPendingPermissionActions = {
  canReply: boolean;
  isSubmittingByRequestId: Record<string, boolean>;
  errorByRequestId: Record<string, string>;
  onReply: (requestId: string, reply: "once" | "always" | "reject") => Promise<void>;
};

type AgentChatComposerConfig = {
  taskId: string;
  activeSession: Pick<
    AgentSessionState,
    | "sessionId"
    | "selectedModel"
    | "isLoadingModelCatalog"
    | "pendingPermissions"
    | "pendingQuestions"
  > | null;
  isSessionWorking: boolean;
  isWaitingInput: boolean;
  busySendBlockedReason: string | null;
  canStopSession: boolean;
  stopAgentSession: (sessionId: string) => Promise<void>;
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
  supportsSlashCommands: boolean;
  supportsFileSearch: boolean;
  slashCommandCatalog: AgentChatComposerModel["slashCommandCatalog"];
  slashCommands: AgentChatComposerModel["slashCommands"];
  slashCommandsError: string | null;
  isSlashCommandsLoading: boolean;
  searchFiles: (query: string) => Promise<import("@openducktor/core").AgentFileSearchResult[]>;
  agentOptions: ComboboxOption[];
  modelOptions: ComboboxOption[];
  modelGroups: ComboboxGroup[];
  variantOptions: ComboboxOption[];
  onSelectAgent: (agent: string) => void;
  onSelectModel: (model: string) => void;
  onSelectVariant: (variant: string) => void;
};

type UseAgentChatSurfaceModelArgs = {
  mode: AgentChatMode;
  session: AgentSessionState | null;
  isTaskHydrating: boolean;
  contextSwitchVersion: number;
  showThinkingMessages: boolean;
  isSessionWorking: boolean;
  isSessionHistoryLoading: boolean;
  isWaitingForRuntimeReadiness: boolean;
  sessionRuntimeDataError: string | null;
  runtimeReadiness: AgentChatRuntimeReadiness;
  emptyState: AgentChatEmptyStateModel | null;
  pendingQuestions: AgentChatPendingQuestionActions;
  permissions: AgentChatPendingPermissionActions;
  composer?: AgentChatComposerConfig;
  sessionAgentColors?: Record<string, string>;
};

export function useAgentChatSurfaceModel({
  mode,
  session,
  isTaskHydrating,
  contextSwitchVersion,
  showThinkingMessages,
  isSessionWorking,
  isSessionHistoryLoading,
  isWaitingForRuntimeReadiness,
  sessionRuntimeDataError,
  runtimeReadiness,
  emptyState,
  pendingQuestions,
  permissions,
  composer,
  sessionAgentColors,
}: UseAgentChatSurfaceModelArgs): AgentChatSurfaceModel {
  const [todoPanelCollapsedBySession, setTodoPanelCollapsedBySession] = useState<
    Record<string, boolean>
  >({});
  const { threadSession, activeSessionId, isContextSwitching } = useAgentChatThreadContext({
    activeSession: session,
    isTaskHydrating,
    contextSwitchVersion,
  });
  const syncBottomAfterComposerLayoutRef = useRef<(() => void) | null>(null);
  const { messagesContainerRef, composerFormRef, composerEditorRef, resizeComposerEditor } =
    useAgentChatLayout({
      activeSessionId: threadSession?.sessionId ?? null,
      syncBottomAfterComposerLayoutRef,
    });
  const scrollToBottomOnSendRef = useRef<(() => void) | null>(null);
  const pendingInlineCommentCount = useInlineCommentDraftStore((store) => store.getDraftCount());

  const resolvedSessionAgentColors = useMemo(() => {
    if (sessionAgentColors) {
      return sessionAgentColors;
    }
    return buildSessionAgentColors(session?.modelCatalog);
  }, [session?.modelCatalog, sessionAgentColors]);

  const activeTodoPanelCollapsed = activeSessionId
    ? (todoPanelCollapsedBySession[activeSessionId] ?? true)
    : true;

  const handleToggleTodoPanel = useCallback((): void => {
    if (!activeSessionId) {
      return;
    }
    setTodoPanelCollapsedBySession((current) => ({
      ...current,
      [activeSessionId]: !(current[activeSessionId] ?? true),
    }));
  }, [activeSessionId]);

  const isInteractiveEnabled = mode === "interactive" && runtimeReadiness.isReady;

  const threadModel = useMemo(
    () => ({
      session: threadSession,
      isSessionWorking,
      showThinkingMessages,
      isSessionViewLoading: isContextSwitching,
      isSessionHistoryLoading,
      isWaitingForRuntimeReadiness,
      readinessState: runtimeReadiness.readinessState,
      isInteractionEnabled: isInteractiveEnabled,
      blockedReason: runtimeReadiness.blockedReason,
      isLoadingChecks: runtimeReadiness.isLoadingChecks,
      onRefreshChecks: (): void => {
        void runtimeReadiness.refreshChecks();
      },
      emptyState,
      isStarting: composer?.isStarting ?? false,
      isSending: composer?.isSending ?? false,
      sessionAgentColors: resolvedSessionAgentColors,
      canSubmitQuestionAnswers:
        mode === "interactive" && isInteractiveEnabled && pendingQuestions.canSubmit,
      isSubmittingQuestionByRequestId: pendingQuestions.isSubmittingByRequestId,
      onSubmitQuestionAnswers: pendingQuestions.onSubmit,
      canReplyToPermissions: mode === "interactive" && isInteractiveEnabled && permissions.canReply,
      isSubmittingPermissionByRequestId: permissions.isSubmittingByRequestId,
      permissionReplyErrorByRequestId: permissions.errorByRequestId,
      onReplyPermission: permissions.onReply,
      sessionRuntimeDataError,
      todoPanelCollapsed: activeTodoPanelCollapsed,
      onToggleTodoPanel: handleToggleTodoPanel,
      messagesContainerRef,
      scrollToBottomOnSendRef,
      syncBottomAfterComposerLayoutRef,
    }),
    [
      activeTodoPanelCollapsed,
      composer?.isSending,
      composer?.isStarting,
      emptyState,
      handleToggleTodoPanel,
      isContextSwitching,
      isInteractiveEnabled,
      isSessionHistoryLoading,
      isSessionWorking,
      isWaitingForRuntimeReadiness,
      messagesContainerRef,
      mode,
      pendingQuestions,
      permissions,
      resolvedSessionAgentColors,
      runtimeReadiness,
      sessionRuntimeDataError,
      showThinkingMessages,
      threadSession,
    ],
  );

  const waitingInputPlaceholder =
    mode === "interactive" && composer?.activeSession
      ? getAgentSessionWaitingInputPlaceholder(composer.activeSession)
      : null;
  const hasComposer = composer != null;
  const composerTaskId = composer?.taskId ?? "";
  const composerActiveSessionIsLoadingModelCatalog =
    composer?.activeSession?.isLoadingModelCatalog ?? false;
  const composerActiveSessionSelectedModel = composer?.activeSession?.selectedModel ?? null;
  const composerIsReadOnly = composer?.isReadOnly ?? false;
  const composerReadOnlyReason = composer?.readOnlyReason ?? null;
  const composerBusySendBlockedReason = composer?.busySendBlockedReason ?? null;
  const composerDraftStateKey = composer?.draftStateKey ?? "";
  const composerIsSending = composer?.isSending ?? false;
  const composerIsStarting = composer?.isStarting ?? false;
  const composerIsSessionWorking = composer?.isSessionWorking ?? false;
  const composerIsWaitingInput = composer?.isWaitingInput ?? false;
  const composerSelectedModelSelection = composer?.selectedModelSelection ?? null;
  const composerSelectedModelDescriptor = composer?.selectedModelDescriptor;
  const composerIsSelectionCatalogLoading = composer?.isSelectionCatalogLoading ?? false;
  const composerSupportsSlashCommands = composer?.supportsSlashCommands ?? false;
  const composerSupportsFileSearch = composer?.supportsFileSearch ?? false;
  const composerSlashCommandCatalog = composer?.slashCommandCatalog ?? null;
  const composerSlashCommands = composer?.slashCommands ?? [];
  const composerSlashCommandsError = composer?.slashCommandsError ?? null;
  const composerIsSlashCommandsLoading = composer?.isSlashCommandsLoading ?? false;
  const composerSearchFiles = composer?.searchFiles ?? missingInteractiveComposerFileSearch;
  const composerAgentOptions = composer?.agentOptions ?? [];
  const composerModelOptions = composer?.modelOptions ?? [];
  const composerModelGroups = composer?.modelGroups ?? [];
  const composerVariantOptions = composer?.variantOptions ?? [];
  const composerOnSelectAgent = composer?.onSelectAgent ?? missingInteractiveComposerAction;
  const composerOnSelectModel = composer?.onSelectModel ?? missingInteractiveComposerAction;
  const composerOnSelectVariant = composer?.onSelectVariant ?? missingInteractiveComposerAction;
  const composerContextUsage = composer?.contextUsage ?? null;
  const composerCanStopSession = composer?.canStopSession ?? false;

  const previousDraftStateKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== "interactive" || !composer) {
      return;
    }
    const store = useInlineCommentDraftStore.getState();
    const previousDraftStateKey = previousDraftStateKeyRef.current;
    if (previousDraftStateKey === composer.draftStateKey) {
      return;
    }

    if (
      previousDraftStateKey != null &&
      isSessionOnlyDraftStateTransition(previousDraftStateKey, composer.draftStateKey) &&
      store.drafts.some((draft) => draft.status === "submitting")
    ) {
      store.setDraftStateKey(composer.draftStateKey);
    } else {
      store.resetForContext(composer.draftStateKey);
    }

    previousDraftStateKeyRef.current = composer.draftStateKey;
  }, [composer, mode]);

  const composerOnSend = composer?.onSend;
  const handleComposerSend = useCallback(
    async (draft: AgentChatComposerDraft): Promise<boolean> => {
      if (mode !== "interactive" || !composerOnSend) {
        return false;
      }
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
        const didSend = await composerOnSend(nextDraft);
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
    [composerOnSend, mode],
  );

  const composerSessionId = composer?.activeSession?.sessionId ?? null;
  const stopAgentSession = composer?.stopAgentSession;
  const handleStopSession = useCallback((): void => {
    if (!composerSessionId || !stopAgentSession) {
      return;
    }
    void stopAgentSession(composerSessionId).catch(() => undefined);
  }, [composerSessionId, stopAgentSession]);

  const composerModel = useMemo(() => {
    if (mode !== "interactive" || !hasComposer) {
      return undefined;
    }

    const isModelSelectionPending = Boolean(
      composerActiveSessionIsLoadingModelCatalog && !composerActiveSessionSelectedModel,
    );

    return {
      taskId: composerTaskId,
      displayedSessionId: composerSessionId,
      isInteractionEnabled: isInteractiveEnabled,
      isReadOnly: composerIsReadOnly,
      readOnlyReason: composerReadOnlyReason,
      busySendBlockedReason: composerBusySendBlockedReason,
      pendingInlineCommentCount,
      draftStateKey: composerDraftStateKey,
      onSend: handleComposerSend,
      isSending: composerIsSending,
      isStarting: composerIsStarting,
      isSessionWorking: composerIsSessionWorking,
      isWaitingInput: composerIsWaitingInput,
      waitingInputPlaceholder,
      isModelSelectionPending,
      selectedModelSelection: composerSelectedModelSelection,
      ...(composerSelectedModelDescriptor !== undefined
        ? { selectedModelDescriptor: composerSelectedModelDescriptor }
        : {}),
      isSelectionCatalogLoading: composerIsSelectionCatalogLoading,
      supportsSlashCommands: composerSupportsSlashCommands,
      supportsFileSearch: composerSupportsFileSearch,
      slashCommandCatalog: composerSlashCommandCatalog,
      slashCommands: composerSlashCommands,
      slashCommandsError: composerSlashCommandsError,
      isSlashCommandsLoading: composerIsSlashCommandsLoading,
      searchFiles: composerSearchFiles,
      agentOptions: composerAgentOptions,
      modelOptions: composerModelOptions,
      modelGroups: composerModelGroups,
      variantOptions: composerVariantOptions,
      onSelectAgent: composerOnSelectAgent,
      onSelectModel: composerOnSelectModel,
      onSelectVariant: composerOnSelectVariant,
      sessionAgentColors: resolvedSessionAgentColors,
      contextUsage: composerContextUsage,
      canStopSession: composerCanStopSession,
      onStopSession: handleStopSession,
      composerFormRef,
      composerEditorRef,
      onComposerEditorInput: resizeComposerEditor,
      scrollToBottomOnSendRef,
      syncBottomAfterComposerLayoutRef,
    };
  }, [
    composerActiveSessionIsLoadingModelCatalog,
    composerActiveSessionSelectedModel,
    composerAgentOptions,
    composerBusySendBlockedReason,
    composerCanStopSession,
    composerContextUsage,
    composerDraftStateKey,
    composerIsReadOnly,
    composerIsSelectionCatalogLoading,
    composerIsSending,
    composerIsSessionWorking,
    composerIsSlashCommandsLoading,
    composerIsStarting,
    composerIsWaitingInput,
    composerModelGroups,
    composerModelOptions,
    composerOnSelectAgent,
    composerOnSelectModel,
    composerOnSelectVariant,
    composerReadOnlyReason,
    composerSearchFiles,
    composerSelectedModelDescriptor,
    composerSelectedModelSelection,
    composerSlashCommandCatalog,
    composerSlashCommands,
    composerSlashCommandsError,
    composerSupportsFileSearch,
    composerSupportsSlashCommands,
    composerTaskId,
    composerVariantOptions,
    composerEditorRef,
    composerFormRef,
    composerSessionId,
    handleComposerSend,
    handleStopSession,
    hasComposer,
    isInteractiveEnabled,
    mode,
    pendingInlineCommentCount,
    resizeComposerEditor,
    resolvedSessionAgentColors,
    waitingInputPlaceholder,
  ]);

  return useMemo(
    () => ({
      mode,
      thread: threadModel,
      ...(composerModel ? { composer: composerModel } : {}),
    }),
    [composerModel, mode, threadModel],
  );
}
