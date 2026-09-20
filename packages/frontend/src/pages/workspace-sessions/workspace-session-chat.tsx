import {
  canInteractWithWorkspaceSession,
  canResumeWorkspaceSession,
  projectWorkspaceSessionChatState,
} from "./workspace-session-chat-state";
import { useWorkspaceSessionPromptInput } from "./use-workspace-session-prompt-input";
import type { ChatSettings, ReusablePrompt, WorkspaceSession } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactElement, useCallback, useMemo } from "react";
import { AgentChatSurface } from "@/components/features/agents/agent-chat/agent-chat";
import { deriveAgentChatReadiness } from "@/components/features/agents/agent-chat/agent-chat-readiness";
import { resolveAgentChatRuntimePresentation } from "@/components/features/agents/agent-chat/agent-chat-runtime-presentation";
import { resolveAgentChatTranscriptPresentation } from "@/components/features/agents/agent-chat/agent-chat-transcript-presentation";
import { useAgentChatSurfaceModel } from "@/components/features/agents/agent-chat/use-agent-chat-surface-model";
import { useAgentSessionApprovalActions } from "@/components/features/agents/agent-chat/use-agent-session-approval-actions";
import { useAgentSessionQuestionActions } from "@/components/features/agents/agent-chat/use-agent-session-question-actions";
import { useSelectedSessionContextUsage } from "@/features/agent-chat-composer/context-usage/use-selected-session-context-usage";
import {
  getAgentSessionWaitingInputPlaceholder,
  isAgentSessionBlockedOnInput,
} from "@/lib/agent-session-waiting-input";
import { repoRuntimeReadinessTargetForRuntime } from "@/lib/repo-runtime-readiness";
import { useRepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import { useRuntimeAvailabilityContext } from "@/state/app-state-contexts";
import {
  useAgentOperations,
  useAgentSession,
  useAgentSessionReadModelState,
} from "@/state/app-state-provider";
import { useSelectedSessionContextLoad } from "@/state/operations/agent-orchestrator/history/use-selected-session-context-load";
import { useSelectedSessionHistoryLoad } from "@/state/operations/agent-orchestrator/history/use-selected-session-history-load";
import { useSessionRuntimeData } from "@/state/operations/agent-orchestrator/hooks/use-session-runtime-data";
import { workspaceSessionIdentity } from "@/state/operations/agent-orchestrator/session-read-model/workspace-session-records";
import {
  resolveRuntimeCatalogSurface,
  retryRuntimeCatalog,
  runtimeCatalogQueryOptions,
} from "@/state/queries/runtime-catalog";
import { createWorkspaceSessionChatDraftPersistence } from "./workspace-session-chat-draft";
import type { ActiveWorkspace } from "@/types/state-slices";
import { useWorkspaceSessionModelPicker } from "./use-workspace-session-model-picker";
import { useWorkspaceSessionChatActions } from "./use-workspace-session-chat-actions";

type WorkspaceSessionChatProps = {
  workspace: ActiveWorkspace;
  record: WorkspaceSession;
  chatSettings: ChatSettings;
  reusablePrompts: ReusablePrompt[];
};

export function WorkspaceSessionChat({
  workspace,
  record,
  chatSettings,
  reusablePrompts,
}: WorkspaceSessionChatProps): ReactElement {
  const identity = useMemo(() => workspaceSessionIdentity(record), [record]);
  const session = useAgentSession(identity);
  const actions = useWorkspaceSessionChatActions(workspace, record);
  const { isSending, isStarting, isSavingModel, updateDraftModel } = actions;
  const draftPersistence = useMemo(
    () => createWorkspaceSessionChatDraftPersistence(workspace.workspaceId, record.id),
    [workspace.workspaceId, record.id],
  );
  const operations = useAgentOperations();
  const readModel = useAgentSessionReadModelState();
  const runtime = useRuntimeAvailabilityContext();
  const queryClient = useQueryClient();
  const runtimeReadiness = useRepoRuntimeReadiness({
    hasWorkspace: true,
    runtimeTarget: repoRuntimeReadinessTargetForRuntime(record.runtimeKind),
  });
  const recordsError = readModel.workspaceSessionRecordsError;
  const fault = readModel.getSessionFault(identity);
  const {
    sessionKey,
    selectedModel,
    transcriptSession,
    transcriptTarget,
    canStopSession,
    observationReady,
    targetFault,
    activityState,
    isWorking,
    transcriptState,
    pendingApprovals,
    pendingQuestions,
    isReadOnly,
    readOnlyReason,
  } = projectWorkspaceSessionChatState({
    record,
    identity,
    session,
    readModelLoadState: readModel.sessionReadModelLoadState,
    repoReadinessState: runtimeReadiness.state,
    fault,
  });
  const runtimeData = useSessionRuntimeData({
    repoPath: workspace.repoPath,
    selectedSession:
      identity && !isStarting
        ? { identity, selectedModel, sessionAssociation: { kind: "repository" } }
        : null,
    runtimeDefinitions: runtime.allRuntimeDefinitions,
    repoReadinessState: runtimeReadiness.state,
    loadRuntimeCatalog: runtime.loadRepoRuntimeCatalog,
    readSessionTodos: operations.readSessionTodos,
  });
  const runtimeRef = useMemo(
    () => ({
      repoPath: workspace.repoPath,
      runtimeKind: record.runtimeKind,
      workingDirectory: record.executionTarget.workingDirectory,
    }),
    [record.executionTarget.workingDirectory, record.runtimeKind, workspace.repoPath],
  );
  const catalogQuery = useQuery({
    ...runtimeCatalogQueryOptions(runtimeRef, runtime.loadRepoRuntimeCatalog),
    enabled: runtimeReadiness.state === "ready",
  });
  const modelSurface = resolveRuntimeCatalogSurface(catalogQuery.data?.models, catalogQuery.error);
  const modelCatalog = modelSurface.catalog;
  const catalogError = modelSurface.error;
  const isLoadingModelCatalog = catalogQuery.isFetching;
  useSelectedSessionHistoryLoad({
    session: isStarting ? null : session,
    repoReadinessState: runtimeReadiness.state,
  });
  const contextError = useSelectedSessionContextLoad({
    session: isStarting ? null : session,
    repoReadinessState: runtimeReadiness.state,
  });
  const retryModelCatalog = useCallback(
    () =>
      retryRuntimeCatalog({
        queryClient,
        runtimeRef,
        loadRuntimeCatalog: runtime.loadRepoRuntimeCatalog,
      }),
    [queryClient, runtime.loadRepoRuntimeCatalog, runtimeRef],
  );
  const modelTarget = useMemo(
    () => ({
      identity,
      runtimeKind: record.runtimeKind,
      runtimeRef,
      updateDraft: updateDraftModel,
      selection: selectedModel,
      catalog: modelCatalog,
      isLoading: isLoadingModelCatalog,
      error: catalogError,
      retry: retryModelCatalog,
      update: operations.updateAgentSessionModel,
    }),
    [
      identity,
      record.runtimeKind,
      runtimeRef,
      updateDraftModel,
      selectedModel,
      modelCatalog,
      isLoadingModelCatalog,
      catalogError,
      retryModelCatalog,
      operations.updateAgentSessionModel,
    ],
  );
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
      repoReadinessState: runtimeReadiness.state,
      reusablePrompts,
    });
  const contextUsage = useSelectedSessionContextUsage({
    selectedSession: session,
    sessionModelCatalog: modelCatalog,
    selectedModelEntry: picker.selectedModelEntry,
  });
  const readiness = deriveAgentChatReadiness({
    transcriptState,
    runtimeReadiness,
    runtimeBlockedAction: {
      label: "Recheck",
      onAction: () => void runtimeReadiness.refreshChecks(),
    },
    failedTranscriptAction: {
      label: "Retry",
      onAction: () => {
        if (identity) void operations.loadAgentSessionHistory(identity);
      },
    },
  });
  const canResumeSession = canResumeWorkspaceSession({
    identity,
    isStarting,
    activityState,
    messages: session?.messages.items ?? [],
    runtimeDefinitions: runtime.allRuntimeDefinitions,
    runtimeKind: record.runtimeKind,
  });
  const canInteract = canInteractWithWorkspaceSession({
    runtimeInteractionEnabled: readiness.interactionEnabled,
    observationReady,
    recordsError,
    targetFault,
    isSavingModel,
  });
  const approvalActions = useAgentSessionApprovalActions({
    sessionIdentity: identity,
    pendingApprovals,
    canReplyToApprovals: canInteract,
    replyAgentApproval: operations.replyAgentApproval,
  });
  const questionRequests = pendingQuestions;
  const questionActions = useAgentSessionQuestionActions({
    sessionIdentity: identity,
    pendingQuestions: questionRequests,
    canAnswerQuestions: canInteract,
    answerAgentQuestion: operations.answerAgentQuestion,
    sessionScope: { kind: "repository" },
  });
  const transcript = resolveAgentChatTranscriptPresentation({
    repoPath: workspace.repoPath,
    sessionKey,
    session: transcriptSession,
    target: transcriptTarget,
    state: transcriptState,
    notice: targetFault
      ? {
          kind: "session_failed",
          severity: "error",
          title: "Workspace Session target mismatch",
          description: targetFault.message,
          action: { label: "Retry", onAction: readModel.reloadSessionReadModel },
        }
      : readiness.transcriptNotice,
  });
  const surface = useAgentChatSurfaceModel({
    transcript,
    chatSettings,
    modelCatalog,
    sessionAuxiliaryError:
      [
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
    pendingApprovalRequests: pendingApprovals,
    pendingQuestionRequests: questionRequests,
    todos: runtimeData.todos,
    sessionAgentColors: picker.agentAccentColorsByProfileId,
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
            error: actions.resumeSessionError,
            onResume: () => {
              if (identity) {
                actions.resumeInterruptedTurn(identity);
              }
            },
          }
        : undefined,
    composer: {
      displayedSessionKey: sessionKey,
      selectedSession: identity ? { ...identity, selectedModel } : null,
      isSessionModelCatalogLoading: isLoadingModelCatalog,
      isSessionWorking: isWorking,
      isWaitingInput: isAgentSessionBlockedOnInput({ pendingApprovals, pendingQuestions }),
      waitingInputPlaceholder: getAgentSessionWaitingInputPlaceholder({
        pendingApprovals,
        pendingQuestions,
      }),
      busySendBlockedReason: null,
      canStopSession,
      stopAgentSession: operations.stopAgentSession,
      isResumingSession: actions.isResumingSession,
      isReadOnly,
      readOnlyReason,
      draftScope: { key: draftPersistence.targetKey, persistence: draftPersistence },
      onSend: (draft) =>
        actions.sendDraft(draft, {
          canSend: canInteract,
          reusablePrompts,
          selectedModelDescriptor: picker.selectedModelEntry,
          supportsAttachments: support.supportsAttachments,
        }),
      isSending,
      isStarting,
      contextUsage,
      selectedModelSelection: selectedModel,
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
  return <AgentChatSurface model={surface} />;
}
