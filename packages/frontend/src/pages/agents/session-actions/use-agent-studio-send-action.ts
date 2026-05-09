import type { ReusablePrompt, TaskCard } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentRole, AgentUserMessagePart } from "@openducktor/core";
import { useCallback, useRef, useState } from "react";
import { validateComposerAttachments } from "@/components/features/agents/agent-chat/agent-chat-attachments";
import {
  type AgentChatComposerDraft,
  draftHasMeaningfulContent,
  draftHasSlashCommandSegment,
  resolveDraftToUserMessageParts,
} from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { resolveReusablePromptDraftToUserMessageParts } from "@/components/features/agents/agent-chat/agent-chat-reusable-prompts";
import { stageLocalAttachmentFile } from "@/lib/local-attachment-files";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace, AgentStateContextValue } from "@/types/state-slices";
import {
  buildAgentStudioAsyncActivityContextKey,
  canStartSessionForRole,
  decrementActivityCountRecord,
  incrementActivityCountRecord,
} from "../use-agent-studio-session-action-helpers";

type UseAgentStudioSendActionArgs = {
  activeWorkspace: ActiveWorkspace | null;
  taskId: string;
  role: AgentRole;
  activeExternalSessionId: string | null;
  activeSessionIsLoadingModelCatalog: boolean;
  activeSessionSelectedModel: AgentSessionState["selectedModel"] | null;
  agentStudioReady: boolean;
  canQueueBusyFollowups: boolean;
  reusablePrompts: ReusablePrompt[];
  isStarting: boolean;
  isWaitingInput: boolean;
  busySendBlockedReason: string | null;
  selectedTask: TaskCard | null;
  selectedModelDescriptor: AgentModelCatalog["models"][number] | null | undefined;
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  startSession: () => Promise<string | undefined>;
};

export function useAgentStudioSendAction({
  activeWorkspace,
  taskId,
  role,
  activeExternalSessionId,
  activeSessionIsLoadingModelCatalog,
  activeSessionSelectedModel,
  agentStudioReady,
  canQueueBusyFollowups,
  reusablePrompts,
  isStarting,
  isWaitingInput,
  busySendBlockedReason,
  selectedTask,
  selectedModelDescriptor,
  sendAgentMessage,
  startSession,
}: UseAgentStudioSendActionArgs): {
  isSending: boolean;
  onSend: (draft: AgentChatComposerDraft) => Promise<boolean>;
} {
  const [sendingActivityCountByContext, setSendingActivityCountByContext] = useState<
    Record<string, number>
  >({});
  const sendInFlightRef = useRef(false);
  const activeComposerContextKey = buildAgentStudioAsyncActivityContextKey({
    activeWorkspace,
    taskId,
    role,
    externalSessionId: activeExternalSessionId,
  });
  const isSending = (sendingActivityCountByContext[activeComposerContextKey] ?? 0) > 0;

  const onSend = useCallback(
    async (draft: AgentChatComposerDraft): Promise<boolean> => {
      if (
        (!canQueueBusyFollowups && (isSending || sendInFlightRef.current)) ||
        isStarting ||
        !agentStudioReady ||
        isWaitingInput ||
        busySendBlockedReason
      ) {
        return false;
      }
      if (!canStartSessionForRole(selectedTask, role)) {
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
      sendInFlightRef.current = true;
      const sendContextKeys = new Set<string>([activeComposerContextKey]);
      setSendingActivityCountByContext((current) =>
        incrementActivityCountRecord(current, activeComposerContextKey),
      );

      try {
        let targetExternalSessionId: string | null | undefined = activeExternalSessionId;
        if (!targetExternalSessionId) {
          targetExternalSessionId = await startSession();
        }

        if (!targetExternalSessionId) {
          return false;
        }

        const targetComposerContextKey = buildAgentStudioAsyncActivityContextKey({
          activeWorkspace,
          taskId,
          role,
          externalSessionId: targetExternalSessionId,
        });
        if (!sendContextKeys.has(targetComposerContextKey)) {
          sendContextKeys.add(targetComposerContextKey);
          setSendingActivityCountByContext((current) =>
            incrementActivityCountRecord(current, targetComposerContextKey),
          );
        }
        await sendAgentMessage(
          targetExternalSessionId,
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
        sendInFlightRef.current = false;
        setSendingActivityCountByContext((current) => {
          let next = current;
          for (const contextKey of sendContextKeys) {
            next = decrementActivityCountRecord(next, contextKey);
          }
          return next;
        });
      }
    },
    [
      activeWorkspace,
      activeComposerContextKey,
      activeExternalSessionId,
      activeSessionIsLoadingModelCatalog,
      activeSessionSelectedModel,
      agentStudioReady,
      canQueueBusyFollowups,
      reusablePrompts,
      isSending,
      isStarting,
      isWaitingInput,
      busySendBlockedReason,
      role,
      selectedTask,
      selectedModelDescriptor?.attachmentSupport,
      sendAgentMessage,
      startSession,
      taskId,
    ],
  );

  return { isSending, onSend };
}
