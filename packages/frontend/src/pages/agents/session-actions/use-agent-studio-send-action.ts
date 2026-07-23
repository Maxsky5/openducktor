import type { ReusablePrompt } from "@openducktor/contracts";
import {
  type AgentModelCatalog,
  type AgentRole,
  classifySystemSlashCommandInvocation,
} from "@openducktor/core";
import { useCallback } from "react";
import type { AgentChatComposerDraft } from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import {
  buildAgentStudioSessionActivityKey,
  useAgentStudioAsyncActivityTracker,
} from "../use-agent-studio-async-activity";
import { resolveAgentStudioSendDraftParts } from "./agent-studio-send-draft";
import {
  canResolveAgentStudioSendTargetSession,
  resolveAgentStudioSendTargetSession,
  type StartSessionForMessage,
} from "./agent-studio-send-target";
import type { AgentStudioSessionActionState } from "./agent-studio-session-action-state";

type AgentStudioSendActionState = Pick<
  AgentStudioSessionActionState,
  "isWaitingInput" | "canQueueBusyFollowups" | "busySendBlockedReason"
>;

type UseAgentStudioSendActionArgs = {
  workspaceId: string | null;
  taskId: string;
  role: AgentRole;
  selectedSessionIdentity: AgentSessionIdentity | null;
  selectedSessionModel: AgentSessionState["selectedModel"];
  sessionState: AgentStudioSendActionState;
  isSessionModelCatalogLoading: boolean;
  isSelectedSessionModelSendable: boolean;
  agentStudioReady: boolean;
  canStartNewSession: boolean;
  reusablePrompts: ReusablePrompt[];
  isStarting: boolean;
  selectedModelDescriptor: AgentModelCatalog["models"][number] | null | undefined;
  supportsAttachments: boolean;
  sendAgentMessage: AgentOperationsContextValue["sendAgentMessage"];
  startSession: StartSessionForMessage;
};

export function useAgentStudioSendAction({
  workspaceId,
  taskId,
  role,
  selectedSessionIdentity,
  selectedSessionModel,
  sessionState,
  isSessionModelCatalogLoading,
  isSelectedSessionModelSendable,
  agentStudioReady,
  canStartNewSession,
  reusablePrompts,
  isStarting,
  selectedModelDescriptor,
  supportsAttachments,
  sendAgentMessage,
  startSession,
}: UseAgentStudioSendActionArgs): {
  isSending: boolean;
  onSend: (draft: AgentChatComposerDraft) => Promise<boolean>;
} {
  const {
    begin: beginSendingActivity,
    hasInFlight: hasSendingActivityInFlight,
    isActive: isSendingActivityActive,
  } = useAgentStudioAsyncActivityTracker();
  const activeComposerContextKey = buildAgentStudioSessionActivityKey({
    workspaceId,
    taskId,
    role,
    session: selectedSessionIdentity,
  });
  const isSending = isSendingActivityActive(activeComposerContextKey);

  const onSend = useCallback(
    async (draft: AgentChatComposerDraft): Promise<boolean> => {
      if (
        (!sessionState.canQueueBusyFollowups &&
          (isSending || hasSendingActivityInFlight(activeComposerContextKey))) ||
        isStarting ||
        !agentStudioReady ||
        sessionState.isWaitingInput ||
        sessionState.busySendBlockedReason
      ) {
        return false;
      }
      if (
        !canResolveAgentStudioSendTargetSession({
          selectedSessionIdentity,
          canStartNewSession,
        })
      ) {
        return false;
      }
      if (isSessionModelCatalogLoading && selectedSessionModel === null) {
        return false;
      }
      if (!isSelectedSessionModelSendable) {
        return false;
      }

      const messagePartsResult = resolveAgentStudioSendDraftParts({
        draft,
        reusablePrompts,
        selectedModelDescriptor,
        supportsAttachments,
      });
      if (!messagePartsResult || !taskId) {
        return false;
      }
      const activity = beginSendingActivity(activeComposerContextKey);

      try {
        const messageParts = await messagePartsResult;
        const systemInvocation = classifySystemSlashCommandInvocation(messageParts);
        if (systemInvocation.kind === "manual_session_compaction") {
          if (!selectedSessionIdentity) {
            throw new Error("/compact requires an existing selected session.");
          }
          if (
            selectedSessionIdentity.runtimeKind !== "opencode" &&
            selectedSessionIdentity.runtimeKind !== "codex" &&
            selectedSessionIdentity.runtimeKind !== "claude"
          ) {
            throw new Error(
              `/compact is unavailable for ${selectedSessionIdentity.runtimeKind} sessions.`,
            );
          }
        }
        const targetSession = await resolveAgentStudioSendTargetSession({
          selectedSessionIdentity,
          canStartNewSession,
          startSession,
        });
        if (!targetSession) {
          return false;
        }

        const targetComposerContextKey = buildAgentStudioSessionActivityKey({
          workspaceId,
          taskId,
          role,
          session: targetSession,
        });
        activity.add(targetComposerContextKey);
        await sendAgentMessage(targetSession, messageParts);
        return true;
      } finally {
        activity.finish();
      }
    },
    [
      activeComposerContextKey,
      agentStudioReady,
      beginSendingActivity,
      canStartNewSession,
      hasSendingActivityInFlight,
      reusablePrompts,
      isSending,
      isStarting,
      isSessionModelCatalogLoading,
      isSelectedSessionModelSendable,
      role,
      selectedModelDescriptor,
      supportsAttachments,
      selectedSessionModel,
      sendAgentMessage,
      startSession,
      sessionState.busySendBlockedReason,
      sessionState.canQueueBusyFollowups,
      sessionState.isWaitingInput,
      selectedSessionIdentity,
      taskId,
      workspaceId,
    ],
  );

  return { isSending, onSend };
}
