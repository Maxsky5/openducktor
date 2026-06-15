import type { ReusablePrompt } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentRole, AgentUserMessagePart } from "@openducktor/core";
import { useCallback, useMemo } from "react";
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
import type { ActiveWorkspace, AgentStateContextValue } from "@/types/state-slices";
import {
  buildAgentStudioSessionActivityKey,
  useAgentStudioAsyncActivityTracker,
} from "../use-agent-studio-async-activity";

type UseAgentStudioSendActionArgs = {
  activeWorkspace: ActiveWorkspace | null;
  taskId: string;
  role: AgentRole;
  activeSession: AgentSessionIdentity | null;
  activeSessionIsLoadingModelCatalog: boolean;
  activeSessionSelectedModel: AgentSessionState["selectedModel"] | null;
  agentStudioReady: boolean;
  canStartNewSession: boolean;
  canQueueBusyFollowups: boolean;
  reusablePrompts: ReusablePrompt[];
  isStarting: boolean;
  isWaitingInput: boolean;
  busySendBlockedReason: string | null;
  selectedModelDescriptor: AgentModelCatalog["models"][number] | null | undefined;
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  startSession: () => Promise<SessionStartWorkflowResult | undefined>;
};

export function useAgentStudioSendAction({
  activeWorkspace,
  taskId,
  role,
  activeSession,
  activeSessionIsLoadingModelCatalog,
  activeSessionSelectedModel,
  agentStudioReady,
  canStartNewSession,
  canQueueBusyFollowups,
  reusablePrompts,
  isStarting,
  isWaitingInput,
  busySendBlockedReason,
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
  const activeSessionIdentity = useMemo(
    () => (activeSession ? toAgentSessionIdentity(activeSession) : null),
    [activeSession],
  );
  const activeComposerContextKey = buildAgentStudioSessionActivityKey({
    activeWorkspace,
    taskId,
    role,
    session: activeSessionIdentity,
  });
  const isSending = isSendingActivityActive(activeComposerContextKey);

  const onSend = useCallback(
    async (draft: AgentChatComposerDraft): Promise<boolean> => {
      if (
        (!canQueueBusyFollowups &&
          (isSending || hasSendingActivityInFlight(activeComposerContextKey))) ||
        isStarting ||
        !agentStudioReady ||
        isWaitingInput ||
        busySendBlockedReason
      ) {
        return false;
      }
      if (!activeSessionIdentity && !canStartNewSession) {
        return false;
      }
      if (activeSessionIsLoadingModelCatalog && !activeSessionSelectedModel) {
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
        let targetSession: AgentSessionIdentity | null | undefined = activeSessionIdentity;
        if (!targetSession) {
          const startedSession = await startSession();
          targetSession = startedSession ? toAgentSessionIdentity(startedSession) : null;
        }

        if (!targetSession) {
          return false;
        }

        const targetComposerContextKey = buildAgentStudioSessionActivityKey({
          activeWorkspace,
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
      activeWorkspace,
      activeComposerContextKey,
      activeSessionIdentity,
      activeSessionIsLoadingModelCatalog,
      activeSessionSelectedModel,
      agentStudioReady,
      beginSendingActivity,
      canStartNewSession,
      canQueueBusyFollowups,
      hasSendingActivityInFlight,
      reusablePrompts,
      isSending,
      isStarting,
      isWaitingInput,
      busySendBlockedReason,
      role,
      selectedModelDescriptor?.attachmentSupport,
      sendAgentMessage,
      startSession,
      taskId,
    ],
  );

  return { isSending, onSend };
}
