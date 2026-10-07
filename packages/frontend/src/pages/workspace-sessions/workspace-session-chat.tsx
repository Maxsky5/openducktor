import { latestTurnUsageLimit } from "@/lib/agent-session-interrupted-turn";
import { useReviewCommentComposer } from "@/features/agent-chat-composer/use-review-comment-composer";
import {
  canInteractWithWorkspaceSession,
  canResumeWorkspaceSession,
  projectWorkspaceSessionChatState,
} from "./workspace-session-chat-state";
import { useWorkspaceSessionPromptInput } from "./use-workspace-session-prompt-input";
import type { ChatSettings, ReusablePrompt, WorkspaceSession } from "@openducktor/contracts";
import { type ReactElement, useMemo } from "react";
import { AgentChatSurface } from "@/components/features/agents/agent-chat/agent-chat";
import { resolveAgentChatRuntimePresentation } from "@/components/features/agents/agent-chat/agent-chat-runtime-presentation";
import { useAgentChatSurfaceModel } from "@/components/features/agents/agent-chat/use-agent-chat-surface-model";
import { useAgentChatPresentation } from "@/components/features/agents/agent-chat/use-agent-chat-presentation";
import { useAgentSessionApprovalActions } from "@/components/features/agents/agent-chat/use-agent-session-approval-actions";
import { useAgentSessionQuestionActions } from "@/components/features/agents/agent-chat/use-agent-session-question-actions";
import { useSelectedSessionContextUsage } from "@/features/agent-chat-composer/context-usage/use-selected-session-context-usage";
import { getBusyAgentMessageBlockedReason } from "@/lib/agent-message-send-policy";
import {
  getAgentSessionWaitingInputPlaceholder,
  isAgentSessionBlockedOnInput,
} from "@/lib/agent-session-waiting-input";
import { runtimeReadinessTargetForRuntime } from "@/lib/runtime-readiness";
import { useRuntimeReadiness } from "@/lib/use-runtime-readiness";
import { useStableAgentSessionIdentity } from "@/lib/use-stable-agent-session-identity";
import { useRuntimeAvailabilityContext } from "@/state/app-state-contexts";
import {
  useAgentOperations,
  useAgentSession,
  useAgentSessionReadModelState,
} from "@/state/app-state-provider";
import { useSelectedSessionContextLoad } from "@/state/operations/agent-orchestrator/history/use-selected-session-context-load";
import { useSelectedSessionHistoryLoad } from "@/state/operations/agent-orchestrator/history/use-selected-session-history-load";
import { useSessionRuntimeData } from "@/state/operations/agent-orchestrator/hooks/use-session-runtime-data";
import {
  workspaceSessionIdentity,
  workspaceSessionTitle,
} from "@/state/operations/agent-orchestrator/session-read-model/workspace-session-records";
import { createWorkspaceSessionChatDraftPersistence } from "./workspace-session-chat-draft";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  useWorkspaceConflictChatActions,
  type WorkspaceConflictChatActions,
} from "./use-workspace-conflict-chat-actions";
import { useWorkspaceSessionChatActions } from "./use-workspace-session-chat-actions";
import { useWorkspaceSessionTranscript } from "./use-workspace-session-transcript";
import { useWorkspaceSessionModelPicker } from "./use-workspace-session-model-picker";
import { useWorkspaceSessionModelTarget } from "./use-workspace-session-model-target";
import { useWorkspaceSessionLaunchRecovery } from "./use-workspace-session-launch-recovery";
import { useWorkspaceSessionToolRefresh } from "./use-workspace-session-tool-refresh";

type WorkspaceSessionChatProps = {
  workspace: ActiveWorkspace;
  record: WorkspaceSession;
  chatSettings: ChatSettings;
  reusablePrompts: ReusablePrompt[];
  onToolRefresh: () => void;
  isMounted: () => boolean;
  visitKey?: number;
  onActionsReady?:
    | ((ownerKey: string, actions: WorkspaceConflictChatActions | null) => void)
    | undefined;
};

export function WorkspaceSessionChat({
  workspace,
  record,
  chatSettings,
  reusablePrompts,
  onToolRefresh,
  isMounted,
  visitKey = 0,
  onActionsReady,
}: WorkspaceSessionChatProps): ReactElement {
  const identity = useStableAgentSessionIdentity(workspaceSessionIdentity(record));
  const session = useAgentSession(identity);
  useWorkspaceSessionToolRefresh(session, onToolRefresh);
  const actions = useWorkspaceSessionChatActions(workspace, record, isMounted);
  useWorkspaceSessionLaunchRecovery(workspace, record.id, workspaceSessionTitle(record));
  const { isSending, isStarting, isSavingModel } = actions;
  const draftPersistence = useMemo(
    () => createWorkspaceSessionChatDraftPersistence(workspace.workspaceId, record.id),
    [workspace.workspaceId, record.id],
  );
  const operations = useAgentOperations();
  const readModel = useAgentSessionReadModelState();
  const runtime = useRuntimeAvailabilityContext();
  const runtimeReadiness = useRuntimeReadiness({
    hasWorkspace: true,
    runtimeTarget: runtimeReadinessTargetForRuntime(record.runtimeKind),
  });
  const recordsError = readModel.workspaceSessionRecordsError;
  const fault = readModel.getSessionFault(identity);
  const chatState = useMemo(
    () =>
      projectWorkspaceSessionChatState({
        record,
        identity,
        session,
        readModelLoadState: readModel.sessionReadModelLoadState,
        runtimeReadinessState: runtimeReadiness.state,
        fault,
      }),
    [record, identity, session, readModel.sessionReadModelLoadState, runtimeReadiness.state, fault],
  );
  const runtimeData = useSessionRuntimeData({
    repoPath: workspace.repoPath,
    selectedSession:
      identity && !isStarting
        ? {
            identity,
            selectedModel: chatState.selectedModel,
            sessionAssociation: { kind: "repository" },
          }
        : null,
    runtimeDefinitions: runtime.allRuntimeDefinitions,
    runtimeReadinessState: runtimeReadiness.state,
    loadRuntimeCatalog: runtime.loadRepoRuntimeCatalog,
    readSessionTodos: operations.readSessionTodos,
  });
  const modelTarget = useWorkspaceSessionModelTarget({
    repoPath: workspace.repoPath,
    record,
    identity,
    selection: chatState.selectedModel,
    readinessState: runtimeReadiness.state,
    updateDraft: actions.updateDraftModel,
    update: actions.updateSessionModel,
  });
  const {
    catalog: modelCatalog,
    error: catalogError,
    isLoading: isLoadingModelCatalog,
  } = modelTarget;
  const sessionLoad = {
    session: isStarting ? null : session,
    runtimeReadinessState: runtimeReadiness.state,
  };
  useSelectedSessionHistoryLoad(sessionLoad);
  const contextError = useSelectedSessionContextLoad(sessionLoad);
  const picker = useWorkspaceSessionModelPicker(workspace.repoPath, modelTarget);
  const runtimePresentation = useMemo(
    () =>
      resolveAgentChatRuntimePresentation({
        runtimeDefinitions: runtime.allRuntimeDefinitions,
        runtimeKind: record.runtimeKind,
      }),
    [runtime.allRuntimeDefinitions, record.runtimeKind],
  );
  const { support, slashCommands, skills, subagents, searchFiles, refreshCatalogIfStale } =
    useWorkspaceSessionPromptInput({
      repoPath: workspace.repoPath,
      record,
      identity,
      runtimeReadinessState: runtimeReadiness.state,
      reusablePrompts,
    });
  const contextUsage = useSelectedSessionContextUsage({
    selectedSession: session,
    sessionModelCatalog: modelCatalog,
    selectedModelEntry: picker.selectedModelEntry,
  });
  const presentation = useAgentChatPresentation({
    session: chatState.transcriptSession,
    sessionIdentity: identity,
    pendingApprovals: chatState.pendingApprovals,
    pendingQuestions: chatState.pendingQuestions,
    skills: skills.skills,
    profileId: chatState.selectedModel?.profileId,
    runtimeKind: record.runtimeKind,
    sessionAgentColors: picker.agentAccentColorsByProfileId,
    runtimeReadiness,
  });
  const { readiness, transcript, retryError } = useWorkspaceSessionTranscript({
    repoPath: workspace.repoPath,
    state: chatState,
    presentation,
    fault,
    runtimeReadiness,
    readModel,
    loadHistory: operations.loadAgentSessionHistory,
  });
  const descriptor =
    runtime.allRuntimeDefinitions.find((entry) => entry.kind === record.runtimeKind) ?? null;
  const busySendBlockedReason = getBusyAgentMessageBlockedReason(chatState.isWorking, descriptor);
  const assertCanSubmit = useWorkspaceConflictChatActions({
    workspace,
    record,
    session,
    actions,
    readiness: runtimeReadiness,
    readOnlyReason: chatState.isReadOnly ? chatState.readOnlyReason : null,
    onActionsReady,
  });
  const canResumeSession = canResumeWorkspaceSession({
    identity,
    isStarting,
    activityState: chatState.activityState,
    messages: session?.messages.items ?? [],
    runtimeDefinitions: runtime.allRuntimeDefinitions,
    runtimeKind: record.runtimeKind,
  });
  const canInteract = canInteractWithWorkspaceSession({
    runtimeInteractionEnabled: readiness.interactionEnabled,
    observationReady: chatState.observationReady,
    recordsError,
    targetFault: chatState.targetFault,
  });
  const approvalActions = useAgentSessionApprovalActions({
    sessionIdentity: identity,
    pendingApprovals: chatState.pendingApprovals,
    canReplyToApprovals: canInteract,
    replyAgentApproval: operations.replyAgentApproval,
  });
  const questionActions = useAgentSessionQuestionActions({
    sessionIdentity: identity,
    pendingQuestions: chatState.pendingQuestions,
    canAnswerQuestions: canInteract,
    answerAgentQuestion: operations.answerAgentQuestion,
    sessionScope: { kind: "repository" },
  });
  const reviewComments = useReviewCommentComposer({
    owner: { kind: "workspace_session", workspaceId: workspace.workspaceId, sessionId: record.id },
    onSend: (draft) =>
      actions.sendDraft(draft, {
        canSend: canInteract && !busySendBlockedReason,
        assertCanSubmit,
        reusablePrompts,
        selectedModelDescriptor: picker.selectedModelEntry,
        supportsAttachments: support.supportsAttachments,
      }),
  });
  const surface = useAgentChatSurfaceModel({
    transcript,
    chatSettings,
    modelCatalog,
    sessionAuxiliaryError:
      [
        retryError,
        actions.error,
        recordsError,
        fault?.message,
        contextError,
        runtimeData.contextError,
        runtimeData.runtimePolicyError,
        runtimeData.todosError,
        catalogError,
        canResumeSession && canInteract ? null : actions.persistentResumeError,
      ].find((error) => error != null) ?? null,
    interactionEnabled: canInteract,
    runtimePresentation,
    emptyState: null,
    pendingApprovalRequests: chatState.pendingApprovals,
    pendingQuestionRequests: chatState.pendingQuestions,
    todos: runtimeData.todos,
    sessionAccentColor: presentation.sessionAccentColor,
    sessionAgentColors: picker.agentAccentColorsByProfileId,
    subagentPendingApprovalCountBySessionKey: presentation.subagentPendingApprovalCountBySessionKey,
    subagentPendingQuestionCountBySessionKey: presentation.subagentPendingQuestionCountBySessionKey,
    approvals: {
      canReply: canInteract,
      isSubmittingByRequestId: approvalActions.isSubmittingApprovalByRequestId,
      errorByRequestId: approvalActions.approvalReplyErrorByRequestId,
      onReply: approvalActions.onReplyApproval,
    },
    pendingQuestions: {
      canSubmit: canInteract,
      isSubmittingByRequestId: questionActions.isSubmittingQuestionByRequestId,
      onSubmit: questionActions.onSubmitQuestionAnswers,
    },
    interruptedTurnResume:
      canResumeSession && canInteract
        ? {
            isPending: actions.isResumingSession,
            isDisabled: isSavingModel,
            error: actions.resumeSessionError,
            usageLimit: latestTurnUsageLimit(session?.messages.items ?? []),
            onResume: () => {
              if (identity) actions.resumeInterruptedTurn(identity);
            },
          }
        : undefined,
    composer: {
      displayedSessionKey: chatState.sessionKey,
      selectedSession: identity ? { ...identity, selectedModel: chatState.selectedModel } : null,
      isSessionModelCatalogLoading: isLoadingModelCatalog,
      isSessionWorking: chatState.isWorking,
      isWaitingInput: isAgentSessionBlockedOnInput(chatState),
      waitingInputPlaceholder: getAgentSessionWaitingInputPlaceholder(chatState),
      busySendBlockedReason,
      canStopSession: chatState.canStopSession,
      stopAgentSession: operations.stopAgentSession,
      isResumingSession: actions.isResumingSession,
      isReadOnly: chatState.isReadOnly,
      readOnlyReason: chatState.readOnlyReason,
      draftScope: { key: draftPersistence.targetKey, persistence: draftPersistence },
      onSend: reviewComments.onSend,
      pendingSendItems: reviewComments.pendingSendItems ?? undefined,
      isSending,
      isStarting,
      isSavingModel,
      contextUsage,
      selectedModelSelection: chatState.selectedModel,
      selectedModelDescriptor: picker.selectedModelEntry,
      isSelectionCatalogLoading: picker.isLoading,
      supportsProfiles: picker.supportsProfiles,
      supportsAttachments: support.supportsAttachments,
      supportsFileSearch: support.supportsFileSearch,
      supportsSkillReferences: support.supportsSkillReferences,
      supportsSubagentReferences: support.supportsSubagentReferences,
      ...slashCommands,
      ...skills,
      ...subagents,
      onCatalogMenuOpen: refreshCatalogIfStale,
      onAgentSelectorOpen: refreshCatalogIfStale,
      onVariantSelectorOpen: refreshCatalogIfStale,
      searchFiles,
      agentOptions: picker.agentProfileOptions,
      variantOptions: picker.variantOptions,
      onSelectAgent: picker.handleSelectAgentProfile,
      onSelectVariant: picker.handleSelectVariant,
      modelPicker: picker.modelPicker,
    },
  });
  return <AgentChatSurface model={surface} visitKey={visitKey} />;
}
