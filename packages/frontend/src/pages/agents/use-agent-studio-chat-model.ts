import { hasRuntimeType } from "@openducktor/contracts";
import type { ChatSettings, RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { useMemo } from "react";
import { resolveAgentSessionAccentColor } from "@/components/features/agents/agent-accent-color";
import type {
  AgentChatModel,
  AgentChatPendingSendItems,
} from "@/components/features/agents/agent-chat/agent-chat.types";
import type { AgentChatComposerDraft } from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import type { AgentChatDraftScope } from "@/components/features/agents/agent-chat/agent-chat-draft-scope";
import { deriveAgentChatReadiness } from "@/components/features/agents/agent-chat/agent-chat-readiness";
import { resolveAgentChatRuntimePresentation } from "@/components/features/agents/agent-chat/agent-chat-runtime-presentation";
import { resolveAgentChatTranscriptPresentation } from "@/components/features/agents/agent-chat/agent-chat-transcript-presentation";
import { withClaudeSkillMentions } from "@/components/features/agents/agent-chat/claude-skill-mentions";
import { useAgentChatSurfaceModel } from "@/components/features/agents/agent-chat/use-agent-chat-surface-model";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { AgentStudioContextUsage } from "@/features/agent-chat-composer/context-usage/context-usage-resolution";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { useStableAgentSessionIdentity } from "@/lib/use-stable-agent-session-identity";
import { useAgentSessionReadModelState } from "@/state/app-state-provider";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import {
  type AgentStudioChatDraftScope,
  agentStudioChatDraftScopeKey,
  createAgentStudioChatDraftPersistence,
} from "./agent-studio-chat-draft";
import { deriveAgentStudioChatSurfaceState } from "./agent-studio-chat-surface-state";
import {
  toAgentStudioTranscriptSession,
  toAgentStudioTranscriptTarget,
} from "./agent-studio-transcript";
import type { AgentStudioSelectedSessionContext } from "./selected-session/selected-session-context";
import { useAgentStudioReviewCommentComposerAdapter } from "./use-agent-studio-review-comment-composer-adapter";

export type AgentStudioChatSessionActionsContext = {
  isStarting: boolean;
  isSending: boolean;
  isSessionWorking: boolean;
  isWaitingInput: boolean;
  busySendBlockedReason: string | null;
  canUseKickoffPrompt: boolean;
  kickoffLabel: string;
  canStopSession: boolean;
  startLaunchKickoff: () => Promise<void>;
  onSend: (draft: AgentChatComposerDraft) => Promise<boolean>;
  stopAgentSession: AgentOperationsContextValue["stopAgentSession"];
  loadAgentSessionHistory: AgentOperationsContextValue["loadAgentSessionHistory"];
};

export type AgentStudioChatModelSelectionContext = {
  selectedModelSelection: AgentModelSelection | null;
  selectedModelDescriptor?: AgentChatModel["composer"]["selectedModelDescriptor"];
  isSelectionCatalogLoading: boolean;
  supportsProfiles?: boolean;
  supportsAttachments: boolean;
  supportsSlashCommands: boolean;
  supportsFileSearch: boolean;
  supportsSkillReferences: boolean;
  supportsSubagentReferences: boolean;
  slashCommandCatalog: AgentChatModel["composer"]["slashCommandCatalog"];
  slashCommands: AgentChatModel["composer"]["slashCommands"];
  slashCommandsError: string | null;
  isSlashCommandsLoading: boolean;
  skillCatalog: AgentChatModel["composer"]["skillCatalog"];
  skills: AgentChatModel["composer"]["skills"];
  skillsError: string | null;
  isSkillsLoading: boolean;
  subagentCatalog: AgentChatModel["composer"]["subagentCatalog"];
  subagents: AgentChatModel["composer"]["subagents"];
  subagentsError: string | null;
  isSubagentsLoading: boolean;
  searchFiles: AgentChatModel["composer"]["searchFiles"];
  agentOptions: ComboboxOption[];
  modelPicker: AgentChatModel["composer"]["modelPicker"];
  variantOptions: ComboboxOption[];
  onSelectAgent: (agent: string) => void;
  onSelectVariant: (variant: string) => void;
  agentAccentColorsByProfileId: Record<string, string>;
  selectedSessionContextUsage: AgentStudioContextUsage;
};

export type AgentStudioChatComposerContext = {
  draftScope: AgentStudioChatDraftScope;
  workspaceId: string | null;
};

type UseAgentStudioChatModelArgs = {
  selectedSession: AgentStudioSelectedSessionContext;
  sessionActions: AgentStudioChatSessionActionsContext;
  modelSelection: AgentStudioChatModelSelectionContext;
  chatSettings: ChatSettings;
  runtimeDefinitions: RuntimeDescriptor[];
  composer: AgentStudioChatComposerContext;
};

const toChatContextUsage = (
  selectedSessionContextUsage: AgentStudioContextUsage,
): AgentChatModel["composer"]["contextUsage"] => {
  if (selectedSessionContextUsage === null) {
    return null;
  }

  return {
    totalTokens: selectedSessionContextUsage.totalTokens,
    contextWindow: selectedSessionContextUsage.contextWindow,
    ...(hasRuntimeType(selectedSessionContextUsage.outputLimit, "number")
      ? { outputLimit: selectedSessionContextUsage.outputLimit }
      : undefined),
  };
};

export function useAgentStudioChatModel({
  selectedSession,
  sessionActions,
  modelSelection,
  chatSettings,
  runtimeDefinitions,
  composer,
}: UseAgentStudioChatModelArgs): AgentChatModel {
  const { loadAgentSessionHistory } = sessionActions;
  const subagentPendingApprovalCountBySessionKey =
    selectedSession.pendingInput.subagentPendingApprovalCountBySessionKey;
  const subagentPendingQuestionCountBySessionKey =
    selectedSession.pendingInput.subagentPendingQuestionCountBySessionKey;
  const selectedSessionState = selectedSession.selectedSession;
  const { sessionReadModelLoadState, reloadSessionReadModel } = useAgentSessionReadModelState();
  const selectedSessionIdentity = selectedSessionState.identity;
  const selectedSessionModel = selectedSessionState.selectedModel;
  const selectedSessionRuntimeData = selectedSessionState.runtimeData;
  const transcriptSession = useMemo(() => {
    const session = toAgentStudioTranscriptSession({
      identity: selectedSessionIdentity,
      activityState: selectedSessionState.activityState,
      loadedSession: selectedSessionState.loadedSession,
    });
    return session ? withClaudeSkillMentions(session, modelSelection.skills) : null;
  }, [
    modelSelection.skills,
    selectedSessionIdentity,
    selectedSessionState.activityState,
    selectedSessionState.loadedSession,
  ]);
  const pendingApprovalRequests = selectedSession.pendingInput.pendingApprovalRequests;
  const pendingQuestionRequests = selectedSession.pendingInput.pendingQuestionRequests;
  const sessionAccentColor = useMemo(
    () =>
      resolveAgentSessionAccentColor({
        agentName: selectedSessionModel?.profileId,
        agentColors: modelSelection.agentAccentColorsByProfileId,
        runtimeKind: selectedSessionIdentity?.runtimeKind ?? null,
      }),
    [
      modelSelection.agentAccentColorsByProfileId,
      selectedSessionIdentity?.runtimeKind,
      selectedSessionModel?.profileId,
    ],
  );
  const chatContextUsage = useMemo(
    () => toChatContextUsage(modelSelection.selectedSessionContextUsage),
    [modelSelection.selectedSessionContextUsage],
  );
  const selectedSessionTranscriptState = selectedSessionState.transcriptState;
  const selectedSessionAuxiliaryError = selectedSessionState.sessionAuxiliaryError;
  const runtimeReadiness = selectedSessionState.runtimeReadiness;
  const { refreshChecks: refreshRuntimeChecks } = runtimeReadiness;
  const pendingQuestions = selectedSession.pendingInput.pendingQuestions;
  const approvals = selectedSession.pendingInput.approvals;
  const selectedSessionKey = selectedSessionIdentity
    ? agentSessionIdentityKey(selectedSessionIdentity)
    : null;
  const stableSelectedSessionIdentity = useStableAgentSessionIdentity(selectedSessionIdentity);
  const transcriptTarget = useMemo(
    () =>
      toAgentStudioTranscriptTarget({
        identity: stableSelectedSessionIdentity,
        taskId: selectedSession.taskId,
        role: selectedSession.role,
      }),
    [selectedSession.role, selectedSession.taskId, stableSelectedSessionIdentity],
  );
  const draftPersistence = useMemo(
    () =>
      createAgentStudioChatDraftPersistence({
        workspaceId: composer.workspaceId,
        taskId: selectedSession.taskId,
        session: stableSelectedSessionIdentity,
      }),
    [composer.workspaceId, selectedSession.taskId, stableSelectedSessionIdentity],
  );
  const surfaceState = useMemo(
    () =>
      deriveAgentStudioChatSurfaceState({
        taskId: selectedSession.taskId,
        selectedSessionKey,
        transcriptState: selectedSessionTranscriptState,
        workflow: {
          selectedRoleAvailable: selectedSession.workflow.selectedRoleAvailable,
          selectedRoleReadOnlyReason: selectedSession.workflow.selectedRoleReadOnlyReason,
        },
        isStarting: sessionActions.isStarting,
        canUseKickoffPrompt: sessionActions.canUseKickoffPrompt,
        kickoffLabel: sessionActions.kickoffLabel,
        startLaunchKickoff: sessionActions.startLaunchKickoff,
      }),
    [
      selectedSessionKey,
      selectedSession.taskId,
      selectedSession.workflow.selectedRoleAvailable,
      selectedSession.workflow.selectedRoleReadOnlyReason,
      selectedSessionTranscriptState,
      sessionActions.canUseKickoffPrompt,
      sessionActions.isStarting,
      sessionActions.kickoffLabel,
      sessionActions.startLaunchKickoff,
    ],
  );
  const failedTranscriptAction = useMemo(() => {
    const historyLoadFailed =
      (selectedSessionTranscriptState.kind === "failed" &&
        selectedSessionTranscriptState.historyFailure != null) ||
      (selectedSessionTranscriptState.kind === "visible" &&
        selectedSessionTranscriptState.historyFailure != null);
    if (
      historyLoadFailed &&
      selectedSessionIdentity !== null &&
      selectedSessionState.loadedSession !== null
    ) {
      return {
        label: "Retry",
        onAction: () => {
          void loadAgentSessionHistory(selectedSessionIdentity);
        },
      };
    }

    if (
      selectedSessionTranscriptState.kind !== "failed" ||
      selectedSessionState.loadedSession !== null ||
      (sessionReadModelLoadState.kind !== "failed" && selectedSessionAuxiliaryError === null)
    ) {
      return null;
    }

    return {
      label: "Retry",
      onAction: reloadSessionReadModel,
    };
  }, [
    reloadSessionReadModel,
    selectedSessionIdentity,
    selectedSessionState.loadedSession,
    selectedSessionAuxiliaryError,
    selectedSessionTranscriptState,
    loadAgentSessionHistory,
    sessionReadModelLoadState.kind,
  ]);
  const runtimeBlockedAction = useMemo(
    () => ({
      label: "Recheck",
      onAction: () => {
        void refreshRuntimeChecks();
      },
      disabled: runtimeReadiness.isLoadingChecks,
      isPending: runtimeReadiness.isLoadingChecks,
    }),
    [refreshRuntimeChecks, runtimeReadiness.isLoadingChecks],
  );
  const chatReadiness = useMemo(
    () =>
      deriveAgentChatReadiness({
        transcriptState: selectedSessionTranscriptState,
        runtimeReadiness: {
          state: runtimeReadiness.state,
          message: runtimeReadiness.message,
        },
        runtimeBlockedAction,
        failedTranscriptAction,
      }),
    [
      failedTranscriptAction,
      runtimeBlockedAction,
      runtimeReadiness.message,
      runtimeReadiness.state,
      selectedSessionTranscriptState,
    ],
  );
  const runtimePresentation = useMemo(
    () =>
      resolveAgentChatRuntimePresentation({
        runtimeDefinitions,
        runtimeKind: selectedSessionIdentity?.runtimeKind ?? null,
      }),
    [runtimeDefinitions, selectedSessionIdentity?.runtimeKind],
  );
  const transcript = useMemo(
    () =>
      resolveAgentChatTranscriptPresentation({
        sessionKey: selectedSessionKey,
        session: transcriptSession,
        target: transcriptTarget,
        state: selectedSessionTranscriptState,
        notice: chatReadiness.transcriptNotice,
      }),
    [
      chatReadiness.transcriptNotice,
      selectedSessionKey,
      selectedSessionTranscriptState,
      transcriptSession,
      transcriptTarget,
    ],
  );
  const draftStateKey = agentStudioChatDraftScopeKey(composer.workspaceId, composer.draftScope);
  const composerDraftScope = useMemo<AgentChatDraftScope>(
    () => ({
      key: draftStateKey,
      persistence: draftPersistence,
    }),
    [draftPersistence, draftStateKey],
  );
  const reviewCommentComposer = useAgentStudioReviewCommentComposerAdapter({
    draftScope: composer.draftScope,
    draftStateKey,
    onSend: sessionActions.onSend,
  });
  const pendingSendItems = useMemo<AgentChatPendingSendItems | null>(() => {
    const count = reviewCommentComposer.pendingInlineCommentCount;
    if (count <= 0) {
      return null;
    }

    const commentLabel = count === 1 ? "comment" : "comments";
    return {
      count,
      accessibleLabel: `${count} pending review ${commentLabel}`,
    };
  }, [reviewCommentComposer.pendingInlineCommentCount]);

  const composerConfig = useMemo(
    () => ({
      displayedSessionKey: selectedSessionKey,
      selectedSession: selectedSessionIdentity
        ? {
            ...selectedSessionIdentity,
            selectedModel: selectedSessionModel,
          }
        : null,
      isSessionModelCatalogLoading: selectedSessionRuntimeData.isLoadingModelCatalog,
      isSessionWorking: sessionActions.isSessionWorking,
      isWaitingInput: sessionActions.isWaitingInput,
      waitingInputPlaceholder: selectedSession.pendingInput.waitingInputPlaceholder,
      busySendBlockedReason: sessionActions.busySendBlockedReason,
      canStopSession: sessionActions.canStopSession,
      stopAgentSession: sessionActions.stopAgentSession,
      isReadOnly: surfaceState.composerReadOnly,
      readOnlyReason: surfaceState.composerReadOnlyReason,
      ...(pendingSendItems ? { pendingSendItems } : undefined),
      draftScope: composerDraftScope,
      onSend: reviewCommentComposer.onSend,
      isSending: sessionActions.isSending,
      isStarting: sessionActions.isStarting,
      contextUsage: chatContextUsage,
      selectedModelSelection: modelSelection.selectedModelSelection,
      selectedModelDescriptor: modelSelection.selectedModelDescriptor,
      isSelectionCatalogLoading: modelSelection.isSelectionCatalogLoading,
      supportsProfiles: modelSelection.supportsProfiles ?? true,
      supportsAttachments: modelSelection.supportsAttachments,
      supportsSlashCommands: modelSelection.supportsSlashCommands,
      supportsFileSearch: modelSelection.supportsFileSearch,
      supportsSkillReferences: modelSelection.supportsSkillReferences,
      supportsSubagentReferences: modelSelection.supportsSubagentReferences,
      slashCommandCatalog: modelSelection.slashCommandCatalog,
      slashCommands: modelSelection.slashCommands,
      slashCommandsError: modelSelection.slashCommandsError,
      isSlashCommandsLoading: modelSelection.isSlashCommandsLoading,
      skillCatalog: modelSelection.skillCatalog,
      skills: modelSelection.skills,
      skillsError: modelSelection.skillsError,
      isSkillsLoading: modelSelection.isSkillsLoading,
      subagentCatalog: modelSelection.subagentCatalog,
      subagents: modelSelection.subagents,
      subagentsError: modelSelection.subagentsError,
      isSubagentsLoading: modelSelection.isSubagentsLoading,
      searchFiles: modelSelection.searchFiles,
      agentOptions: modelSelection.agentOptions,
      modelPicker: modelSelection.modelPicker,
      variantOptions: modelSelection.variantOptions,
      onSelectAgent: modelSelection.onSelectAgent,
      onSelectVariant: modelSelection.onSelectVariant,
    }),
    [
      chatContextUsage,
      composerDraftScope,
      modelSelection.agentOptions,
      modelSelection.isSelectionCatalogLoading,
      modelSelection.isSlashCommandsLoading,
      modelSelection.isSkillsLoading,
      modelSelection.isSubagentsLoading,
      modelSelection.modelPicker,
      modelSelection.onSelectAgent,
      modelSelection.onSelectVariant,
      modelSelection.searchFiles,
      modelSelection.selectedModelDescriptor,
      modelSelection.selectedModelSelection,
      modelSelection.slashCommandCatalog,
      modelSelection.slashCommands,
      modelSelection.slashCommandsError,
      modelSelection.skillCatalog,
      modelSelection.skills,
      modelSelection.skillsError,
      modelSelection.subagentCatalog,
      modelSelection.subagents,
      modelSelection.subagentsError,
      modelSelection.supportsFileSearch,
      modelSelection.supportsAttachments,
      modelSelection.supportsProfiles,
      modelSelection.supportsSkillReferences,
      modelSelection.supportsSlashCommands,
      modelSelection.supportsSubagentReferences,
      modelSelection.variantOptions,
      reviewCommentComposer.onSend,
      pendingSendItems,
      selectedSession.pendingInput.waitingInputPlaceholder,
      selectedSessionIdentity,
      selectedSessionModel,
      selectedSessionKey,
      selectedSessionRuntimeData.isLoadingModelCatalog,
      surfaceState.composerReadOnly,
      surfaceState.composerReadOnlyReason,
      sessionActions.busySendBlockedReason,
      sessionActions.canStopSession,
      sessionActions.isSending,
      sessionActions.isSessionWorking,
      sessionActions.isStarting,
      sessionActions.isWaitingInput,
      sessionActions.stopAgentSession,
    ],
  );

  const surfaceModel = useAgentChatSurfaceModel({
    modelCatalog: selectedSessionRuntimeData.modelCatalog,
    transcript,
    chatSettings,
    sessionAuxiliaryError:
      selectedSessionAuxiliaryError ??
      selectedSessionRuntimeData.contextError ??
      selectedSessionRuntimeData.runtimePolicyError ??
      selectedSessionRuntimeData.todosError ??
      selectedSessionRuntimeData.catalogError,
    interactionEnabled: chatReadiness.interactionEnabled,
    runtimePresentation,
    emptyState: surfaceState.emptyState,
    pendingApprovalRequests,
    pendingQuestionRequests,
    todos: selectedSessionRuntimeData.todos,
    sessionAccentColor,
    pendingQuestions,
    approvals,
    composer: composerConfig,
    sessionAgentColors: modelSelection.agentAccentColorsByProfileId,
    subagentPendingApprovalCountBySessionKey,
    subagentPendingQuestionCountBySessionKey,
  });
  const composerModel = surfaceModel.composer;

  if (!composerModel) {
    throw new Error("Interactive Agent Studio chat is missing a composer model.");
  }

  return useMemo(
    () =>
      ({
        ...surfaceModel,
        composer: composerModel,
      }) satisfies AgentChatModel,
    [composerModel, surfaceModel],
  );
}
