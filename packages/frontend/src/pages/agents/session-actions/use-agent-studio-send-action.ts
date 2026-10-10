import { useSessionStartContext } from "@/features/session-start/use-session-start-context";
import { isSessionStartFailureFeedbackHandled } from "@/features/session-start/session-start-orchestration";
import type { SessionStartWorkflowResult } from "@/features/session-start/session-start-workflow";
import { agentStudioChatDraftScopeKey } from "../agent-studio-chat-draft";
import type { AgentChatSendResult } from "@/components/features/agents/agent-chat/agent-chat-send-result";
import type { ReusablePrompt } from "@openducktor/contracts";
import {
  type AgentModelCatalog,
  type AgentRole,
  classifySystemSlashCommandInvocation,
  normalizeAgentUserMessageParts,
} from "@openducktor/core";
import { useCallback } from "react";
import type { AgentChatComposerDraft } from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import {
  buildAgentStudioSessionActivityKey,
  useAgentStudioAsyncActivityTracker,
} from "../use-agent-studio-async-activity";
import { resolveAgentStudioSendDraftParts } from "./agent-studio-send-draft";
import {
  canResolveAgentStudioSendTargetSession,
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
  prepareSelectedSessionModelForSend: () => Promise<boolean>;
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
  prepareSelectedSessionModelForSend,
  agentStudioReady,
  canStartNewSession,
  reusablePrompts,
  isStarting,
  selectedModelDescriptor,
  supportsAttachments,
  sendAgentMessage,
  startSession,
}: UseAgentStudioSendActionArgs) {
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
  const isCurrentContext = useSessionStartContext(activeComposerContextKey);
  const isSending = isSendingActivityActive(activeComposerContextKey);

  const onSend = useCallback(
    async (draft: AgentChatComposerDraft): Promise<AgentChatSendResult> => {
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

      if (!taskId) return false;
      const activity = beginSendingActivity(activeComposerContextKey);
      let started: SessionStartWorkflowResult | undefined;
      try {
        const messagePartsResult = resolveAgentStudioSendDraftParts({
          draft,
          reusablePrompts,
          selectedModelDescriptor,
          supportsAttachments,
        });
        if (!messagePartsResult) return false;
        const messageParts = await messagePartsResult;
        if (!isCurrentContext()) return false;
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
        // A needed model change waits for this send, so viewing a session never resumes it.
        if (!(await prepareSelectedSessionModelForSend())) return false;
        if (!selectedSessionIdentity)
          started = await startSession(normalizeAgentUserMessageParts(messageParts));
        const targetSession =
          selectedSessionIdentity ?? (started ? toAgentSessionIdentity(started) : null);
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
        if (started?.postStartActionError) throw started.postStartActionError;
        if (selectedSessionIdentity) await sendAgentMessage(targetSession, messageParts);
        return true;
      } catch (cause) {
        // The runtime accepted the first message, so the composer must not restore it.
        if (started?.postStartMessageReceipt) return true;
        if (started) {
          return {
            kind: "recover_draft",
            originKey: agentStudioChatDraftScopeKey(workspaceId, { taskId, role, session: null }),
            recoveryKey: agentStudioChatDraftScopeKey(workspaceId, {
              taskId,
              role,
              session: toAgentSessionIdentity(started),
            }),
            error: cause instanceof Error ? cause : new Error(String(cause)),
            inAppFeedbackHandled: isSessionStartFailureFeedbackHandled(cause),
          };
        }
        throw cause;
      } finally {
        activity.finish();
      }
    },
    [
      isCurrentContext,
      activeComposerContextKey,
      agentStudioReady,
      beginSendingActivity,
      canStartNewSession,
      hasSendingActivityInFlight,
      reusablePrompts,
      isSending,
      isStarting,
      isSessionModelCatalogLoading,
      prepareSelectedSessionModelForSend,
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

  return { isSending, onSend } satisfies {
    isSending: boolean;
    onSend: (draft: AgentChatComposerDraft) => Promise<AgentChatSendResult>;
  };
}
