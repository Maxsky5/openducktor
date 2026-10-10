import type { ChatSettings } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentSessionTodoItem } from "@openducktor/core";
import { useMemo, useRef } from "react";
import { isAgentSessionActivityWorking } from "@/lib/agent-session-activity-state";
import type { AgentApprovalRequest, AgentQuestionRequest } from "@/types/agent-orchestrator";
import type {
  AgentChatEmptyStateModel,
  AgentChatInterruptedTurnResumeModel,
  AgentChatRuntimePresentation,
  AgentChatSurfaceModel,
  AgentChatTranscriptPresentation,
} from "./agent-chat.types";
import {
  type AgentChatComposerConfig,
  invokeStopAgentSession,
  useAgentChatComposerModel,
} from "./use-agent-chat-composer-model";
import { useAgentChatLayout } from "./use-agent-chat-layout";
import {
  type AgentChatPendingApprovalActions,
  type AgentChatPendingQuestionActions,
  useAgentChatThreadModel,
} from "./use-agent-chat-thread-model";

export { invokeStopAgentSession };

type UseAgentChatSurfaceModelArgs = {
  modelCatalog?: AgentModelCatalog | null;
  transcript: AgentChatTranscriptPresentation;
  chatSettings: ChatSettings;
  sessionAuxiliaryError: string | null;
  interactionEnabled: boolean;
  runtimePresentation: AgentChatRuntimePresentation;
  emptyState: AgentChatEmptyStateModel | null;
  pendingApprovalRequests: readonly AgentApprovalRequest[];
  pendingQuestionRequests: readonly AgentQuestionRequest[];
  todos: readonly AgentSessionTodoItem[];
  sessionAccentColor?: string | undefined;
  pendingQuestions: AgentChatPendingQuestionActions;
  approvals: AgentChatPendingApprovalActions;
  interruptedTurnResume?: AgentChatInterruptedTurnResumeModel | undefined;
  composer?: AgentChatComposerConfig;
  subagentPendingApprovalCountBySessionKey?: Record<string, number>;
  subagentPendingQuestionCountBySessionKey?: Record<string, number>;
};

export function useAgentChatSurfaceModel({
  modelCatalog,
  transcript,
  chatSettings,
  sessionAuxiliaryError,
  interactionEnabled,
  runtimePresentation,
  emptyState,
  pendingApprovalRequests,
  pendingQuestionRequests,
  todos,
  sessionAccentColor,
  pendingQuestions,
  approvals,
  interruptedTurnResume,
  composer,
  subagentPendingApprovalCountBySessionKey,
  subagentPendingQuestionCountBySessionKey,
}: UseAgentChatSurfaceModelArgs): AgentChatSurfaceModel {
  const isSessionWorking = isAgentSessionActivityWorking(transcript.session?.activityState);
  const { messagesContainerRef, composerFormRef, composerEditorRef, resizeComposerEditor } =
    useAgentChatLayout({
      displayedSessionKey: transcript.displayedSessionKey,
    });
  const scrollToBottomOnSendRef = useRef<(() => void) | null>(null);
  const hasComposer = composer !== undefined;
  const composerIsStarting = composer?.isStarting ?? false;
  const composerIsSending = composer?.isSending ?? false;
  const composerActivity = useMemo(
    () =>
      hasComposer
        ? {
            isStarting: composerIsStarting,
            isSending: composerIsSending,
          }
        : null,
    [composerIsSending, composerIsStarting, hasComposer],
  );

  const composerModel = useAgentChatComposerModel({
    composer,
    interactionEnabled,
    composerFormRef,
    composerEditorRef,
    resizeComposerEditor,
    scrollToBottomOnSendRef,
  });
  const threadModel = useAgentChatThreadModel({
    modelCatalog: modelCatalog ?? null,
    transcript,
    interactionEnabled,
    runtimePresentation,
    isSessionWorking,
    composerActivity,
    sessionAuxiliaryError,
    emptyState,
    pendingApprovalRequests,
    pendingQuestionRequests,
    todos,
    sessionAccentColor,
    pendingQuestions,
    approvals,
    interruptedTurnResume,
    subagentPendingApprovalCountBySessionKey,
    subagentPendingQuestionCountBySessionKey,
    messagesContainerRef,
    scrollToBottomOnSendRef,
  });

  return useMemo(() => {
    const surface: AgentChatSurfaceModel = { chatSettings, thread: threadModel };
    if (composerModel) {
      surface.composer = composerModel;
    }
    return surface;
  }, [chatSettings, composerModel, threadModel]);
}
