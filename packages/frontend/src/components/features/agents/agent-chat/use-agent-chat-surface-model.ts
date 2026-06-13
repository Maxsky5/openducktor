import type {
  ChatSettings,
  RuntimeApprovalReplyOutcome,
  RuntimeDescriptor,
  RuntimeKind,
} from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentModelSelection,
} from "@openducktor/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import { getAgentSessionWaitingInputPlaceholder } from "@/lib/agent-session-waiting-input";
import { useInlineCommentDraftStore } from "@/state/use-inline-comment-draft-store";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { resolveAgentAccentColor, resolveAgentSessionAccentColor } from "../agent-accent-color";
import type {
  AgentChatComposerModel,
  AgentChatEmptyStateModel,
  AgentChatMode,
  AgentChatSurfaceModel,
} from "./agent-chat.types";
import { type AgentChatComposerDraft, appendTextToDraft } from "./agent-chat-composer-draft";
import { useAgentChatLayout } from "./use-agent-chat-layout";
import { useAgentChatThreadContext } from "./use-agent-chat-thread-context";

const EMPTY_SUBAGENT_PENDING_APPROVAL_COUNTS = Object.freeze({}) as Record<string, number>;
const EMPTY_SUBAGENT_PENDING_QUESTION_COUNTS = Object.freeze({}) as Record<string, number>;
const EMPTY_SUBAGENT_PENDING_APPROVALS = Object.freeze({}) as NonNullable<
  AgentSessionState["subagentPendingApprovalsByExternalSessionId"]
>;
const EMPTY_SUBAGENT_PENDING_QUESTIONS = Object.freeze({}) as NonNullable<
  AgentSessionState["subagentPendingQuestionsByExternalSessionId"]
>;
const EMPTY_COMPOSER_SLASH_COMMANDS = Object.freeze(
  [],
) as unknown as AgentChatComposerModel["slashCommands"];
const EMPTY_COMPOSER_SKILLS = Object.freeze([]) as unknown as AgentChatComposerModel["skills"];
const EMPTY_COMPOSER_OPTIONS = Object.freeze([]) as unknown as ComboboxOption[];
const EMPTY_COMPOSER_MODEL_GROUPS = Object.freeze([]) as unknown as ComboboxGroup[];

const parseDraftStateKey = (draftStateKey: string) => {
  const [taskId = "", role = "", externalSessionId = "", contextSwitchVersion = ""] =
    draftStateKey.split(":");
  return { taskId, role, externalSessionId, contextSwitchVersion };
};

const isSessionOnlyDraftStateTransition = (previousKey: string, nextKey: string): boolean => {
  const previous = parseDraftStateKey(previousKey);
  const next = parseDraftStateKey(nextKey);
  return (
    previous.taskId === next.taskId &&
    previous.role === next.role &&
    previous.contextSwitchVersion === next.contextSwitchVersion &&
    previous.externalSessionId !== next.externalSessionId
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

type StopAgentSession = (externalSessionId: string) => Promise<void>;

export const invokeStopAgentSession = (
  externalSessionId: string | null,
  stopAgentSession: StopAgentSession | undefined,
): void => {
  if (!externalSessionId || !stopAgentSession) {
    return;
  }
  void stopAgentSession(externalSessionId).catch(() => undefined);
};

type AgentChatRuntimeReadiness = {
  readinessState: "ready" | "checking" | "blocked";
  isReady: boolean;
  isRuntimeStarting: boolean;
  blockedReason: string | null;
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
};

type AgentChatPendingQuestionActions = {
  canSubmit: boolean;
  isSubmittingByRequestId: Record<string, boolean>;
  onSubmit: (requestId: string, answers: string[][]) => Promise<void>;
};

type AgentChatPendingApprovalActions = {
  canReply: boolean;
  isSubmittingByRequestId: Record<string, boolean>;
  errorByRequestId: Record<string, string>;
  onReply: (requestId: string, outcome: RuntimeApprovalReplyOutcome) => Promise<void>;
};

type AgentChatComposerConfig = {
  taskId: string;
  activeSession:
    | (Pick<
        AgentSessionState,
        | "externalSessionId"
        | "selectedModel"
        | "isLoadingModelCatalog"
        | "pendingApprovals"
        | "pendingQuestions"
      > & {
        runtimeKind: RuntimeKind | null;
      })
    | null;
  isSessionWorking: boolean;
  isWaitingInput: boolean;
  busySendBlockedReason: string | null;
  canStopSession: boolean;
  stopAgentSession: (externalSessionId: string) => Promise<void>;
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
  isSessionSelectionResolving: boolean;
  chatSettings: ChatSettings;
  isSessionWorking: boolean;
  isSessionHistoryLoading: boolean;
  isWaitingForRuntimeReadiness: boolean;
  runtimeDefinitions?: RuntimeDescriptor[];
  sessionRuntimeDataError: string | null;
  runtimeReadiness: AgentChatRuntimeReadiness;
  emptyState: AgentChatEmptyStateModel | null;
  pendingQuestions: AgentChatPendingQuestionActions;
  approvals: AgentChatPendingApprovalActions;
  composer?: AgentChatComposerConfig;
  sessionAgentColors?: Record<string, string>;
  subagentPendingApprovalsByExternalSessionId?: AgentSessionState["subagentPendingApprovalsByExternalSessionId"];
  subagentPendingApprovalCountByExternalSessionId?: Record<string, number>;
  subagentPendingQuestionsByExternalSessionId?: AgentSessionState["subagentPendingQuestionsByExternalSessionId"];
  subagentPendingQuestionCountByExternalSessionId?: Record<string, number>;
};

export function useAgentChatSurfaceModel({
  mode,
  session,
  isTaskHydrating,
  isSessionSelectionResolving,
  chatSettings,
  isSessionWorking,
  isSessionHistoryLoading,
  isWaitingForRuntimeReadiness,
  runtimeDefinitions = [],
  sessionRuntimeDataError,
  runtimeReadiness,
  emptyState,
  pendingQuestions,
  approvals,
  composer,
  sessionAgentColors,
  subagentPendingApprovalsByExternalSessionId,
  subagentPendingApprovalCountByExternalSessionId,
  subagentPendingQuestionsByExternalSessionId,
  subagentPendingQuestionCountByExternalSessionId,
}: UseAgentChatSurfaceModelArgs): AgentChatSurfaceModel {
  const [todoPanelCollapsedBySession, setTodoPanelCollapsedBySession] = useState<
    Record<string, boolean>
  >({});
  const { threadSession, activeExternalSessionId, isContextSwitching } = useAgentChatThreadContext({
    activeSession: session,
    isTaskHydrating,
    isSessionSelectionResolving,
  });
  const syncBottomAfterComposerLayoutRef = useRef<(() => void) | null>(null);
  const { messagesContainerRef, composerFormRef, composerEditorRef, resizeComposerEditor } =
    useAgentChatLayout({
      activeExternalSessionId: threadSession?.externalSessionId ?? null,
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

  const activeTodoPanelCollapsed = activeExternalSessionId
    ? (todoPanelCollapsedBySession[activeExternalSessionId] ?? true)
    : true;

  const handleToggleTodoPanel = useCallback((): void => {
    if (!activeExternalSessionId) {
      return;
    }
    setTodoPanelCollapsedBySession((current) => ({
      ...current,
      [activeExternalSessionId]: !(current[activeExternalSessionId] ?? true),
    }));
  }, [activeExternalSessionId]);

  const isComposerInteractionEnabled = mode === "interactive" && runtimeReadiness.isReady;
  const canSubmitQuestionAnswers = runtimeReadiness.isReady && pendingQuestions.canSubmit;
  const canReplyToApprovalRequests = runtimeReadiness.isReady && approvals.canReply;
  const runtimeSupportedApprovalReplyOutcomes = useMemo(() => {
    const runtimeKind = threadSession?.runtimeKind;
    if (!runtimeKind) {
      return null;
    }
    return (
      findRuntimeDefinition(runtimeDefinitions, runtimeKind)?.capabilities.approvals
        .supportedReplyOutcomes ?? null
    );
  }, [runtimeDefinitions, threadSession?.runtimeKind]);

  const threadModel = useMemo(
    () => ({
      session: threadSession,
      isSessionWorking,
      isSessionViewLoading: isContextSwitching,
      isSessionHistoryLoading,
      isWaitingForRuntimeReadiness,
      readinessState: runtimeReadiness.readinessState,
      isInteractionEnabled: isComposerInteractionEnabled,
      blockedReason: runtimeReadiness.blockedReason,
      isLoadingChecks: runtimeReadiness.isLoadingChecks,
      onRefreshChecks: (): void => {
        void runtimeReadiness.refreshChecks();
      },
      emptyState,
      isStarting: composer?.isStarting ?? false,
      isSending: composer?.isSending ?? false,
      sessionAgentColors: resolvedSessionAgentColors,
      subagentPendingApprovalsByExternalSessionId:
        subagentPendingApprovalsByExternalSessionId ?? EMPTY_SUBAGENT_PENDING_APPROVALS,
      subagentPendingApprovalCountByExternalSessionId:
        subagentPendingApprovalCountByExternalSessionId ?? EMPTY_SUBAGENT_PENDING_APPROVAL_COUNTS,
      subagentPendingQuestionsByExternalSessionId:
        subagentPendingQuestionsByExternalSessionId ?? EMPTY_SUBAGENT_PENDING_QUESTIONS,
      subagentPendingQuestionCountByExternalSessionId:
        subagentPendingQuestionCountByExternalSessionId ?? EMPTY_SUBAGENT_PENDING_QUESTION_COUNTS,
      canSubmitQuestionAnswers,
      isSubmittingQuestionByRequestId: pendingQuestions.isSubmittingByRequestId,
      onSubmitQuestionAnswers: pendingQuestions.onSubmit,
      canReplyToApprovals: canReplyToApprovalRequests,
      runtimeSupportedApprovalReplyOutcomes,
      isSubmittingApprovalByRequestId: approvals.isSubmittingByRequestId,
      approvalReplyErrorByRequestId: approvals.errorByRequestId,
      onReplyApproval: approvals.onReply,
      sessionRuntimeDataError,
      todoPanelCollapsed: activeTodoPanelCollapsed,
      onToggleTodoPanel: handleToggleTodoPanel,
      messagesContainerRef,
      scrollToBottomOnSendRef,
      syncBottomAfterComposerLayoutRef,
    }),
    [
      activeTodoPanelCollapsed,
      canReplyToApprovalRequests,
      canSubmitQuestionAnswers,
      composer?.isSending,
      composer?.isStarting,
      emptyState,
      handleToggleTodoPanel,
      isContextSwitching,
      isComposerInteractionEnabled,
      isSessionHistoryLoading,
      isSessionWorking,
      isWaitingForRuntimeReadiness,
      messagesContainerRef,
      pendingQuestions,
      approvals,
      resolvedSessionAgentColors,
      runtimeReadiness,
      runtimeSupportedApprovalReplyOutcomes,
      sessionRuntimeDataError,
      subagentPendingApprovalsByExternalSessionId,
      subagentPendingApprovalCountByExternalSessionId,
      subagentPendingQuestionsByExternalSessionId,
      subagentPendingQuestionCountByExternalSessionId,
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
  const composerRuntimeKind =
    composer?.activeSession?.runtimeKind ?? composerSelectedModelSelection?.runtimeKind ?? null;
  const composerAccentAgentName = composer?.activeSession
    ? composerActiveSessionSelectedModel?.profileId
    : composerSelectedModelSelection?.profileId;
  const composerAccentColor = useMemo(
    () =>
      resolveAgentSessionAccentColor({
        agentName: composerAccentAgentName,
        agentColors: resolvedSessionAgentColors,
        runtimeKind: composerRuntimeKind,
      }),
    [composerAccentAgentName, composerRuntimeKind, resolvedSessionAgentColors],
  );
  const composerSelectedModelDescriptor = composer?.selectedModelDescriptor;
  const composerIsSelectionCatalogLoading = composer?.isSelectionCatalogLoading ?? false;
  const composerSupportsProfiles = composer?.supportsProfiles ?? true;
  const composerSupportsSlashCommands = composer?.supportsSlashCommands ?? false;
  const composerSupportsFileSearch = composer?.supportsFileSearch ?? false;
  const composerSupportsSkillReferences = composer?.supportsSkillReferences ?? false;
  const composerSlashCommandCatalog = composer?.slashCommandCatalog ?? null;
  const composerSlashCommands = composer?.slashCommands ?? EMPTY_COMPOSER_SLASH_COMMANDS;
  const composerSlashCommandsError = composer?.slashCommandsError ?? null;
  const composerIsSlashCommandsLoading = composer?.isSlashCommandsLoading ?? false;
  const composerSkillCatalog = composer?.skillCatalog ?? null;
  const composerSkills = composer?.skills ?? EMPTY_COMPOSER_SKILLS;
  const composerSkillsError = composer?.skillsError ?? null;
  const composerIsSkillsLoading = composer?.isSkillsLoading ?? false;
  const composerSearchFiles = composer?.searchFiles ?? missingInteractiveComposerFileSearch;
  const composerAgentOptions = composer?.agentOptions ?? EMPTY_COMPOSER_OPTIONS;
  const composerModelOptions = composer?.modelOptions ?? EMPTY_COMPOSER_OPTIONS;
  const composerModelGroups = composer?.modelGroups ?? EMPTY_COMPOSER_MODEL_GROUPS;
  const composerVariantOptions = composer?.variantOptions ?? EMPTY_COMPOSER_OPTIONS;
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

  const composerExternalSessionId = composer?.activeSession?.externalSessionId ?? null;
  const stopAgentSession = composer?.stopAgentSession;
  const handleStopSession = useCallback((): void => {
    invokeStopAgentSession(composerExternalSessionId, stopAgentSession);
  }, [composerExternalSessionId, stopAgentSession]);

  const composerModel = useMemo(() => {
    if (mode !== "interactive" || !hasComposer) {
      return undefined;
    }

    const isModelSelectionPending = Boolean(
      composerActiveSessionIsLoadingModelCatalog && !composerActiveSessionSelectedModel,
    );

    return {
      taskId: composerTaskId,
      displayedSessionId: composerExternalSessionId,
      isInteractionEnabled: isComposerInteractionEnabled,
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
      supportsProfiles: composerSupportsProfiles,
      supportsSlashCommands: composerSupportsSlashCommands,
      supportsFileSearch: composerSupportsFileSearch,
      supportsSkillReferences: composerSupportsSkillReferences,
      slashCommandCatalog: composerSlashCommandCatalog,
      slashCommands: composerSlashCommands,
      slashCommandsError: composerSlashCommandsError,
      isSlashCommandsLoading: composerIsSlashCommandsLoading,
      skillCatalog: composerSkillCatalog,
      skills: composerSkills,
      skillsError: composerSkillsError,
      isSkillsLoading: composerIsSkillsLoading,
      searchFiles: composerSearchFiles,
      agentOptions: composerAgentOptions,
      modelOptions: composerModelOptions,
      modelGroups: composerModelGroups,
      variantOptions: composerVariantOptions,
      onSelectAgent: composerOnSelectAgent,
      onSelectModel: composerOnSelectModel,
      onSelectVariant: composerOnSelectVariant,
      accentColor: composerAccentColor,
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
    composerIsSkillsLoading,
    composerSupportsProfiles,
    composerIsSending,
    composerIsSessionWorking,
    composerIsSlashCommandsLoading,
    composerIsStarting,
    composerIsWaitingInput,
    composerAccentColor,
    composerModelGroups,
    composerModelOptions,
    composerOnSelectAgent,
    composerOnSelectModel,
    composerOnSelectVariant,
    composerReadOnlyReason,
    composerSearchFiles,
    composerSelectedModelDescriptor,
    composerSelectedModelSelection,
    composerSkillCatalog,
    composerSkills,
    composerSkillsError,
    composerSlashCommandCatalog,
    composerSlashCommands,
    composerSlashCommandsError,
    composerSupportsFileSearch,
    composerSupportsSkillReferences,
    composerSupportsSlashCommands,
    composerTaskId,
    composerVariantOptions,
    composerEditorRef,
    composerFormRef,
    composerExternalSessionId,
    handleComposerSend,
    handleStopSession,
    hasComposer,
    isComposerInteractionEnabled,
    mode,
    pendingInlineCommentCount,
    resizeComposerEditor,
    waitingInputPlaceholder,
  ]);

  return useMemo(
    () => ({
      mode,
      chatSettings,
      thread: threadModel,
      ...(composerModel ? { composer: composerModel } : {}),
    }),
    [chatSettings, composerModel, mode, threadModel],
  );
}
