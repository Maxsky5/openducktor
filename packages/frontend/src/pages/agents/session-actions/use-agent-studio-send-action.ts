import type { ReusablePrompt } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentRole, AgentUserMessagePart } from "@openducktor/core";
import { useCallback } from "react";
import { validateComposerAttachments } from "@/components/features/agents/agent-chat/agent-chat-attachments";
import {
  type AgentChatComposerDraft,
  draftHasMeaningfulContent,
  draftHasSlashCommandSegment,
  resolveDraftToUserMessageParts,
} from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { resolveReusablePromptDraftToUserMessageParts } from "@/components/features/agents/agent-chat/agent-chat-reusable-prompts";
import type { SessionStartWorkflowResult } from "@/features/session-start";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { stageLocalAttachmentFile } from "@/lib/local-attachment-files";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import {
  buildAgentStudioSessionActivityKey,
  useAgentStudioAsyncActivityTracker,
} from "../use-agent-studio-async-activity";
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
  agentStudioReady: boolean;
  canStartNewSession: boolean;
  reusablePrompts: ReusablePrompt[];
  isStarting: boolean;
  selectedModelDescriptor: AgentModelCatalog["models"][number] | null | undefined;
  sendAgentMessage: AgentOperationsContextValue["sendAgentMessage"];
  startSession: () => Promise<SessionStartWorkflowResult | undefined>;
};

export function useAgentStudioSendAction({
  workspaceId,
  taskId,
  role,
  selectedSessionIdentity,
  selectedSessionModel,
  sessionState,
  isSessionModelCatalogLoading,
  agentStudioReady,
  canStartNewSession,
  reusablePrompts,
  isStarting,
  selectedModelDescriptor,
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
      if (!selectedSessionIdentity && !canStartNewSession) {
        return false;
      }
      if (isSessionModelCatalogLoading && selectedSessionModel === null) {
        return false;
      }

      let reusablePromptMessageParts: AgentUserMessagePart[] | null;
      try {
        reusablePromptMessageParts = resolveReusablePromptDraftToUserMessageParts(
          draft,
          reusablePrompts,
        );
      } catch {
        return false;
      }

      if ((draft.attachments ?? []).length > 0) {
        if (draftHasSlashCommandSegment(draft)) {
          return false;
        }

        const attachmentErrors = validateComposerAttachments(
          draft.attachments ?? [],
          selectedModelDescriptor?.attachmentSupport,
        );
        if (Object.keys(attachmentErrors).length > 0) {
          return false;
        }
      }

      if (!draftHasMeaningfulContent(draft) || !taskId) {
        return false;
      }
      const activity = beginSendingActivity(activeComposerContextKey);

      try {
        let targetSession: AgentSessionIdentity | null | undefined = selectedSessionIdentity;
        if (!targetSession) {
          const startedSession = await startSession();
          targetSession = startedSession ? toAgentSessionIdentity(startedSession) : null;
        }

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
        await sendAgentMessage(
          targetSession,
          reusablePromptMessageParts ??
            (await resolveDraftToUserMessageParts(draft, async (attachment) => {
              if (attachment.file) {
                return stageLocalAttachmentFile(attachment.file);
              }
              if (attachment.path) {
                return attachment.path;
              }
              throw new Error(`Attachment "${attachment.name}" is missing local file data.`);
            })),
        );
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
      role,
      selectedModelDescriptor?.attachmentSupport,
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
