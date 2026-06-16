import type { ChatSettings, RuntimeDescriptor } from "@openducktor/contracts";
import { useMemo, useRef } from "react";
import type { RepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import type { AgentSessionTranscriptState } from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import type {
  AgentChatEmptyStateModel,
  AgentChatSurfaceModel,
  AgentChatThreadSession,
} from "./agent-chat.types";
import { deriveAgentChatThreadProjection } from "./agent-chat-thread-state";
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

const EMPTY_SESSION_AGENT_COLORS = Object.freeze({}) as Record<string, string>;

type UseAgentChatSurfaceModelArgs = {
  session: AgentChatThreadSession | null;
  transcriptState: AgentSessionTranscriptState;
  chatSettings: ChatSettings;
  isSessionWorking: boolean;
  runtimeDefinitions?: RuntimeDescriptor[];
  sessionAuxiliaryError: string | null;
  runtimeReadiness: RepoRuntimeReadiness;
  emptyState: AgentChatEmptyStateModel | null;
  pendingQuestions: AgentChatPendingQuestionActions;
  approvals: AgentChatPendingApprovalActions;
  composer?: AgentChatComposerConfig;
  sessionAgentColors?: Record<string, string>;
  subagentPendingApprovalCountBySessionKey?: Record<string, number>;
  subagentPendingQuestionCountBySessionKey?: Record<string, number>;
};

export function useAgentChatSurfaceModel({
  session,
  transcriptState,
  chatSettings,
  isSessionWorking,
  runtimeDefinitions = [],
  sessionAuxiliaryError,
  runtimeReadiness,
  emptyState,
  pendingQuestions,
  approvals,
  composer,
  sessionAgentColors,
  subagentPendingApprovalCountBySessionKey,
  subagentPendingQuestionCountBySessionKey,
}: UseAgentChatSurfaceModelArgs): AgentChatSurfaceModel {
  const { threadSession, activeSessionKey } = deriveAgentChatThreadProjection({
    session,
    transcriptState,
  });
  const syncBottomAfterComposerLayoutRef = useRef<(() => void) | null>(null);
  const { messagesContainerRef, composerFormRef, composerEditorRef, resizeComposerEditor } =
    useAgentChatLayout({
      activeSessionKey,
      syncBottomAfterComposerLayoutRef,
    });
  const scrollToBottomOnSendRef = useRef<(() => void) | null>(null);
  const resolvedSessionAgentColors = sessionAgentColors ?? EMPTY_SESSION_AGENT_COLORS;
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
    runtimeReadiness,
    sessionAgentColors: resolvedSessionAgentColors,
    composerFormRef,
    composerEditorRef,
    resizeComposerEditor,
    scrollToBottomOnSendRef,
    syncBottomAfterComposerLayoutRef,
  });
  const threadModel = useAgentChatThreadModel({
    threadSession,
    activeSessionKey,
    transcriptState,
    runtimeReadiness,
    isSessionWorking,
    hasComposer,
    composerActivity,
    runtimeDefinitions,
    sessionAuxiliaryError,
    emptyState,
    pendingQuestions,
    approvals,
    sessionAgentColors: resolvedSessionAgentColors,
    subagentPendingApprovalCountBySessionKey,
    subagentPendingQuestionCountBySessionKey,
    messagesContainerRef,
    scrollToBottomOnSendRef,
    syncBottomAfterComposerLayoutRef,
  });

  return useMemo(
    () => ({
      chatSettings,
      thread: threadModel,
      ...(composerModel ? { composer: composerModel } : {}),
    }),
    [chatSettings, composerModel, threadModel],
  );
}
