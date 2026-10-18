import type { AgentMessageSubmitMode, RuntimeDescriptor } from "@openducktor/contracts";
import {
  type AgentModelCatalog,
  type AgentUserMessagePart,
  resolveRuntimeSteeringAvailability,
} from "@openducktor/core";
import { useCallback, useMemo } from "react";
import type {
  AgentChatComposerModel,
  AgentChatMessageQueueModel,
} from "@/components/features/agents/agent-chat/agent-chat.types";
import type { AgentChatComposerDraft } from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import type { AgentChatSendResult } from "@/components/features/agents/agent-chat/agent-chat-send-result";
import { steersRunningTurn } from "@/components/features/agents/agent-chat/agent-chat-steering";
import {
  findModelEntry,
  findRunningTurnModelEntry,
} from "@/features/agent-chat-composer/model-selection/model-selection-options";
import { MISSING_RUNTIME_REASON } from "@/lib/agent-message-send-policy";
import type { AsyncActivityTracker } from "@/lib/use-async-activity-tracker";
import { useAgentMessageQueue, useAgentOperations } from "@/state/app-state-provider";
import { useHostRuntimeStatusContext } from "@openducktor/frontend-core/sessions/session-contexts";
import type {
  AgentChatMessage,
  AgentMessageSendOptions,
  AgentSessionIdentity,
} from "@openducktor/frontend-core/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import {
  type AgentChatSendDraftInput,
  createAgentChatSendAttachmentStager,
  resolveAgentChatSendDraftParts,
} from "./agent-chat-send-draft";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";

/** Where a send goes: to an existing session, or into the launch of a new session. */
export type AgentChatResolvedTarget =
  | {
      readonly kind: "session";
      readonly identity: AgentSessionIdentity;
      readonly sendOptions?: Omit<AgentMessageSendOptions, "mode">;
    }
  | {
      /** The host launched a new session with the message as its first instruction. */
      readonly kind: "launched";
      readonly result: AgentChatSendResult;
    };

/** What differs between chat kinds: how a chat finds its session and reports a failure. */
export type AgentChatSendTarget = {
  /** Counts the sends of each chat context, so a chat still shows its sends after a switch. */
  readonly activity: AsyncActivityTracker;
  /** The chat context of this composer. */
  readonly activityKey: string;
  /** False while the chat cannot take a message, for example while its model saves. */
  readonly canSend: () => boolean;
  /** Captures the selected recipient before attachment staging starts. */
  readonly capture: () => () => boolean;
  /**
   * Returns the session that takes the message, or launches a new session with it. It can
   * capture the selected recipient. Null drops the send and keeps the draft.
   */
  readonly resolve: (parts: AgentUserMessagePart[]) => Promise<AgentChatResolvedTarget | null>;
  /** Turns a failure into the composer result. Without it, the composer gets the failure. */
  readonly onFailure?: (cause: Error) => AgentChatSendResult;
  /** Runs after each send ends. */
  readonly onSettled?: () => void;
};

type UseAgentChatSendArgs = {
  /** The session of the chat. A new chat has no queue, and its first send launches the session. */
  identity: AgentSessionIdentity | null;
  repoPath: string | null;
  runtimeDescriptor: RuntimeDescriptor | null;
  /** Resolves the models that queued messages captured and the model of the running turn. */
  modelCatalog: AgentModelCatalog | null;
  /** The session transcript. */
  messages: readonly AgentChatMessage[] | undefined;
  isSessionWorking: boolean;
  isWaitingInput: boolean;
  /** The model that a new turn uses. */
  selectedModelDescriptor: AgentModelCatalog["models"][number] | null | undefined;
  /** The content rules of the composer, which also apply to an edited queued message. */
  draftRules: Pick<AgentChatSendDraftInput, "reusablePrompts" | "supportsAttachments">;
  sendAgentMessage: AgentOperationsContextValue["sendAgentMessage"];
  target: AgentChatSendTarget;
};

/** The send state and actions that a chat composer reads. */
export type AgentChatSend = Pick<
  AgentChatComposerModel,
  "messageQueue" | "steerBlockedReason" | "runningTurnModel" | "isSending" | "onSend"
>;

const EMPTY_MESSAGES: readonly AgentChatMessage[] = [];

/**
 * Sends the messages of a task or workspace chat, with its queue panel and steering rules. The
 * chat kind only supplies its `target`.
 */
export function useAgentChatSend({
  identity,
  repoPath,
  runtimeDescriptor,
  modelCatalog,
  messages,
  isSessionWorking,
  isWaitingInput,
  selectedModelDescriptor,
  draftRules: { reusablePrompts, supportsAttachments },
  sendAgentMessage,
  target,
}: UseAgentChatSendArgs): AgentChatSend {
  const { stageAttachment } = useClientConnection();
  const stageSendAttachment = useMemo(
    () => createAgentChatSendAttachmentStager(stageAttachment),
    [stageAttachment],
  );
  const { manageAgentMessageQueue } = useAgentOperations();
  const { statusByKind } = useHostRuntimeStatusContext();
  const sessionRef = useMemo(
    () =>
      identity && repoPath
        ? {
            repoPath,
            runtimeKind: identity.runtimeKind,
            workingDirectory: identity.workingDirectory,
            externalSessionId: identity.externalSessionId,
          }
        : null,
    [repoPath, identity],
  );
  const queue = useAgentMessageQueue(sessionRef);
  const runtimeVersion = identity ? (statusByKind[identity.runtimeKind]?.version ?? null) : null;

  const steerBlockedReason = useMemo((): string | null => {
    if (!identity) return null;
    if (!runtimeDescriptor) return MISSING_RUNTIME_REASON;
    const steering = resolveRuntimeSteeringAvailability(runtimeDescriptor, runtimeVersion);
    return steering.available ? null : steering.reason;
  }, [runtimeDescriptor, runtimeVersion, identity]);

  const runningTurnModel = useMemo(
    () => findRunningTurnModelEntry(modelCatalog, messages ?? EMPTY_MESSAGES),
    [messages, modelCatalog],
  );

  const messageQueue = useMemo((): AgentChatMessageQueueModel | null => {
    if (!identity) return null;
    return {
      queue,
      onAction: (action) => manageAgentMessageQueue(identity, action),
      onSaveEdit: async ({ submissionId, editId }, draft) => {
        const entry = queue?.entries.find((candidate) => candidate.submissionId === submissionId);
        if (!entry) throw new Error("This message is no longer in the queue.");
        // Check an edit with the rules of a new message and the model that the entry captured.
        const parts = await resolveAgentChatSendDraftParts({
          draft,
          reusablePrompts,
          modelDescriptor: findModelEntry(modelCatalog, entry.model ?? null),
          supportsAttachments,
          stageAttachment: stageSendAttachment,
        });
        if (!parts) {
          throw new Error("The edited message is empty or has content that this chat cannot send.");
        }
        await manageAgentMessageQueue(identity, { kind: "save_edit", submissionId, editId, parts });
      },
    };
  }, [
    manageAgentMessageQueue,
    modelCatalog,
    queue,
    reusablePrompts,
    identity,
    stageSendAttachment,
    supportsAttachments,
  ]);

  const onSend = useCallback(
    async (draft: AgentChatComposerDraft, mode: AgentMessageSubmitMode) => {
      // An existing session queues later sends in the host. A new session launches only once.
      if (
        !target.canSend() ||
        isWaitingInput ||
        (identity === null && target.activity.hasInFlight(target.activityKey))
      ) {
        return false;
      }
      const isCurrentRecipient = target.capture();
      const activity = target.activity.begin(target.activityKey);
      try {
        const parts = await resolveAgentChatSendDraftParts({
          draft,
          reusablePrompts,
          // A steer joins the running turn, so the model of that turn checks the content.
          modelDescriptor: steersRunningTurn(mode, isSessionWorking)
            ? runningTurnModel
            : selectedModelDescriptor,
          supportsAttachments,
          stageAttachment: stageSendAttachment,
        });
        if (!parts || !isCurrentRecipient()) return false;
        const resolved = await target.resolve(parts);
        if (!resolved) return false;
        if (resolved.kind === "launched") return resolved.result;
        await sendAgentMessage(resolved.identity, parts, {
          ...resolved.sendOptions,
          mode,
          assertCanSubmit: (session) => {
            if (!isCurrentRecipient())
              throw new Error(
                "The original chat is no longer selected. Reopen it to send your draft.",
              );
            resolved.sendOptions?.assertCanSubmit?.(session);
          },
        });
        return true;
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        if (!target.onFailure) throw error;
        return target.onFailure(error);
      } finally {
        activity.finish();
        target.onSettled?.();
      }
    },
    [
      identity,
      isSessionWorking,
      isWaitingInput,
      reusablePrompts,
      runningTurnModel,
      selectedModelDescriptor,
      sendAgentMessage,
      stageSendAttachment,
      supportsAttachments,
      target,
    ],
  );

  const isSending = target.activity.isActive(target.activityKey);
  // Chats spread this into memoized composer models, so it changes only with its values.
  return useMemo(
    () => ({
      messageQueue,
      steerBlockedReason,
      runningTurnModel,
      isSending,
      onSend,
    }),
    [isSending, messageQueue, onSend, runningTurnModel, steerBlockedReason],
  );
}
