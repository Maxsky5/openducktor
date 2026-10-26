import { sessionForkDisabledReason } from "@openducktor/frontend-core/sessions/session-fork-availability";
import { useWorkspaceSessionFork } from "./use-workspace-session-fork";
import { buildWorkspaceSessionComposer } from "./workspace-session-chat-composer";
import { useAgentChatSend } from "@openducktor/frontend-core/sessions/send/use-agent-chat-send";
import { latestTurnUsageLimit } from "@openducktor/frontend-core/lib/agent-session-interrupted-turn";
import { usePendingSendContext } from "@/features/agent-chat-composer/use-pending-send-context";
import { documentVisibility } from "@/features/session-navigation/document-visibility";
import {
  canInteractWithWorkspaceSession,
  canResumeWorkspaceSession,
  projectWorkspaceSessionChatState,
} from "@openducktor/frontend-core/workspace-sessions/chat/workspace-session-chat-state";
import { useSessionPromptInput } from "@openducktor/frontend-core/sessions/composer/prompt-input/use-session-prompt-input";
import type { ChatSettings, ReusablePrompt, WorkspaceSession } from "@openducktor/contracts";
import { type ReactElement, useMemo } from "react";
import { SessionViewShownActivity } from "@/features/session-navigation/session-view-visibility";
import { AgentChatSurface } from "@/components/features/agents/agent-chat/agent-chat";
import { resolveAgentChatRuntimePresentation } from "@openducktor/frontend-core/sessions/send/agent-chat-runtime-presentation";
import { useAgentChatSurfaceModel } from "@/components/features/agents/agent-chat/use-agent-chat-surface-model";
import { useAgentChatPresentation } from "@openducktor/frontend-core/sessions/transcript/use-agent-chat-presentation";
import { resolveAgentSessionAccentColor } from "@/components/features/agents/agent-accent-color";
import { useAgentSessionApprovalActions } from "@openducktor/frontend-core/sessions/pending-input/use-agent-session-approval-actions";
import { useAgentSessionQuestionActions } from "@openducktor/frontend-core/sessions/pending-input/use-agent-session-question-actions";
import { useSelectedSessionContextUsage } from "@openducktor/frontend-core/sessions/composer/context-usage/use-selected-session-context-usage";
import { isAgentSessionBlockedOnInput } from "@openducktor/frontend-core/lib/agent-session-waiting-input";
import { runtimeReadinessTargetForRuntime } from "@openducktor/frontend-core/lib/runtime-readiness";
import { useRuntimeReadiness } from "@openducktor/frontend-core/lib/use-runtime-readiness";
import { useStableAgentSessionIdentity } from "@openducktor/frontend-core/lib/use-stable-agent-session-identity";
import { useRuntimeAvailabilityContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { useAgentOperations, useAgentSessionReadModelState } from "@/state/app-state-provider";
import { useAgentSession } from "@openducktor/frontend-core/sessions/session-store-hooks";
import { useSelectedSessionContextLoad } from "@openducktor/frontend-core/sessions/agent-orchestrator/history/use-selected-session-context-load";
import { useSelectedSessionHistoryLoad } from "@openducktor/frontend-core/sessions/agent-orchestrator/history/use-selected-session-history-load";
import { useSessionRuntimeData } from "@openducktor/frontend-core/sessions/agent-orchestrator/hooks/use-session-runtime-data";
import { workspaceSessionIdentity } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import { createWorkspaceSessionChatDraftPersistence } from "@openducktor/frontend-core/sessions/composer/workspace-session-chat-draft";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  useWorkspaceConflictChatActions,
  type WorkspaceConflictChatActions,
} from "./use-workspace-conflict-chat-actions";
import { useWorkspaceSessionChatActions } from "./use-workspace-session-chat-actions";
import { useWorkspaceSessionTranscript } from "./use-workspace-session-transcript";
import { useWorkspaceSessionModelPicker } from "./use-workspace-session-model-picker";
import { useWorkspaceSessionModelTarget } from "./use-workspace-session-model-target";
import { useWorkspaceSessionToolRefresh } from "./use-workspace-session-tool-refresh";

type WorkspaceSessionChatProps = {
  isActive: boolean;
  workspace: ActiveWorkspace;
  record: WorkspaceSession;
  chatSettings: ChatSettings | null;
  reusablePrompts: ReusablePrompt[];
  onToolRefresh: () => void;
  isMounted: () => boolean;
  visitKey?: number;
  onActionsReady?:
    | ((ownerKey: string, actions: WorkspaceConflictChatActions | null) => void)
    | undefined;
};

export function WorkspaceSessionChat({
  isActive,
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
  const chatDrafts = useClientConnection().drafts.chat;
  const draftPersistence = useMemo(
    () => createWorkspaceSessionChatDraftPersistence(chatDrafts, workspace.workspaceId, record.id),
    [chatDrafts, workspace.workspaceId, record.id],
  );
  const operations = useAgentOperations();
  const readModel = useAgentSessionReadModelState();
  const runtime = useRuntimeAvailabilityContext();
  const runtimeReadiness = useRuntimeReadiness({
    hasWorkspace: true,
    runtimeTarget: runtimeReadinessTargetForRuntime(record.runtimeKind),
  });
  const actions = useWorkspaceSessionChatActions(
    workspace,
    record,
    isMounted,
    runtimeReadiness.state === "ready" && readModel.sessionReadModelLoadState.kind === "ready",
    visitKey,
  );
  const { isStarting, isSavingModel } = actions;
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
    updateDraft: actions.updateDraftModel,
    updateSpeed: actions.updateSpeed,
    update: actions.updateSessionModel,
  });
  const { catalog: modelCatalog, error: catalogError } = modelTarget;
  useSelectedSessionHistoryLoad({
    session: isActive ? session : null,
    runtimeReadinessState: runtimeReadiness.state,
  });
  const contextError = useSelectedSessionContextLoad({
    session: isStarting ? null : session,
    runtimeReadinessState: runtimeReadiness.state,
  });
  const picker = useWorkspaceSessionModelPicker(workspace.repoPath, modelTarget);
  const runtimePresentation = useMemo(
    () =>
      resolveAgentChatRuntimePresentation({
        runtimeDefinitions: runtime.allRuntimeDefinitions,
        runtimeKind: record.runtimeKind,
      }),
    [runtime.allRuntimeDefinitions, record.runtimeKind],
  );
  const promptInput = useSessionPromptInput({
    repoPath: workspace.repoPath,
    runtimeKind: record.runtimeKind,
    workingDirectory: record.executionTarget.workingDirectory,
    identity,
    runtimeReadinessState: runtimeReadiness.state,
    reusablePrompts,
  });
  const { support, skills } = promptInput;
  const contextUsage = useSelectedSessionContextUsage({
    contextUsage: session?.contextUsage,
    catalog: modelCatalog,
    selectedModelEntry: picker.selectedModelEntry,
  });
  const presentation = useAgentChatPresentation({
    session: chatState.transcriptSession,
    sessionIdentity: identity,
    pendingApprovals: chatState.pendingApprovals,
    pendingQuestions: chatState.pendingQuestions,
    skills: skills.skills,
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
  const assertCanSubmit = useWorkspaceConflictChatActions({
    workspace,
    record,
    session,
    actions,
    readiness: runtimeReadiness,
    readOnlyReason: chatState.isReadOnly ? chatState.readOnlyReason : null,
    onActionsReady,
  });
  const canInteract = canInteractWithWorkspaceSession({
    runtimeInteractionEnabled: readiness.interactionEnabled,
    observationReady: chatState.observationReady,
    recordsError,
    targetFault: chatState.targetFault,
  });
  const canResumeSession =
    canInteract &&
    canResumeWorkspaceSession({
      identity,
      isStarting,
      activityState: chatState.activityState,
      messages: session?.messages.items ?? [],
      runtimeDefinitions: runtime.allRuntimeDefinitions,
      runtimeKind: record.runtimeKind,
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
  const isWaitingInput = isAgentSessionBlockedOnInput(chatState);
  const { sendTarget } = actions;
  const target = useMemo(
    () =>
      sendTarget({
        canSend: canInteract && actions.isPrepared && !picker.isLoading,
        assertCanSubmit,
      }),
    [assertCanSubmit, canInteract, actions.isPrepared, picker.isLoading, sendTarget],
  );
  const messageDelivery = useAgentChatSend({
    identity,
    repoPath: workspace.repoPath,
    runtimeDescriptor: descriptor,
    modelCatalog,
    messages: session?.messages.items,
    isSessionWorking: chatState.isWorking,
    foregroundTurnActive: chatState.foregroundTurnActive,
    isWaitingInput,
    selectedModelDescriptor: picker.selectedModelEntry,
    draftRules: { reusablePrompts, supportsAttachments: support.supportsAttachments },
    sendAgentMessage: operations.sendAgentMessage,
    target,
  });
  const pendingSendContext = usePendingSendContext({
    owner: { kind: "workspace_session", workspaceId: workspace.workspaceId, sessionId: record.id },
    workingDirectory: record.executionTarget.workingDirectory,
    onSend: messageDelivery.onSend,
    visibility: documentVisibility,
  });
  const fork = useWorkspaceSessionFork({
    workspace,
    record,
    visible: isActive,
    disabledReason: sessionForkDisabledReason({
      runtimeReadiness,
      interactionEnabled: canInteract,
      readOnly: chatState.isReadOnly,
      readOnlyReason: chatState.readOnlyReason,
      error: recordsError,
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
        chatState.statusUnavailableReason,
        contextError,
        runtimeData.contextError,
        runtimeData.runtimePolicyError,
        runtimeData.todosError,
        catalogError,
        canResumeSession ? null : actions.persistentResumeError,
      ].find((error) => error != null) ?? null,
    interactionEnabled: canInteract,
    runtimePresentation,
    emptyState: null,
    pendingApprovalRequests: chatState.pendingApprovals,
    pendingQuestionRequests: chatState.pendingQuestions,
    todos: runtimeData.todos,
    sessionAccentColor: resolveAgentSessionAccentColor({ runtimeKind: record.runtimeKind }),
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
    interruptedTurnResume: canResumeSession
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
    composer: buildWorkspaceSessionComposer({
      state: chatState,
      identity,
      actions,
      delivery: messageDelivery,
      pendingSend: pendingSendContext,
      draftPersistence,
      picker,
      promptInput,
      contextUsage,
      stopSession: operations.stopAgentSession,
    }),
  });
  return (
    <SessionViewShownActivity>
      <AgentChatSurface
        model={{
          ...surface,
          thread: { ...surface.thread, forkActions: fork.actions, forkDialog: fork.dialog },
        }}
        visitKey={visitKey}
      />
    </SessionViewShownActivity>
  );
}
