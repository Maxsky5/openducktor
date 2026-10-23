import type {
  AgentMessageSubmitMode,
  AgentQueuedMessage,
  AgentSessionUserMessagePart,
} from "@openducktor/contracts";
import { BLOCKED_ON_INPUT_REASON, steeringPartsBlockedReason } from "@openducktor/core";
import type { AgentChatComposerModel } from "./agent-chat.types";
import {
  type AttachmentToCheck,
  runningTurnAttachmentBlockedReason,
} from "@openducktor/frontend-core/drafts/agent-chat-attachments";
import type { AgentChatComposerDraft } from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import { isReusablePromptSlashCommand } from "./agent-chat-reusable-prompts";

/** The session state that decides whether a queued message can steer the running work. */
export type QueuedMessageSteerContext = Pick<
  AgentChatComposerModel,
  | "steerBlockedReason"
  | "runningTurnModel"
  | "isSessionWorking"
  | "foregroundTurnActive"
  | "isWaitingInput"
>;

/** An idle session takes a steer as a new turn, so steering limits apply only to a running turn. */
export const steersRunningTurn = (
  mode: AgentMessageSubmitMode,
  isSessionWorking: boolean,
): boolean => mode === "steer" && isSessionWorking;

export const composerForegroundTurnActive = (
  context: Pick<AgentChatComposerModel, "foregroundTurnActive" | "isSessionWorking">,
): boolean => context.foregroundTurnActive ?? context.isSessionWorking;

type RunningTurnSteerContext = Pick<
  QueuedMessageSteerContext,
  "steerBlockedReason" | "runningTurnModel"
>;

/** The runtime limit comes first. Then the parts and attachments must suit the running turn. */
const runningTurnSteerBlockedReason = (
  content: {
    readonly parts: ReadonlyArray<Pick<AgentSessionUserMessagePart, "kind">>;
    readonly attachments: readonly AttachmentToCheck[];
  },
  { steerBlockedReason, runningTurnModel }: RunningTurnSteerContext,
): string | null =>
  steerBlockedReason ??
  steeringPartsBlockedReason(content.parts) ??
  runningTurnAttachmentBlockedReason(content.attachments, runningTurnModel);

/** A reusable prompt becomes text before it is sent, so only native commands block steering. */
export const draftSteerBlockedReason = (
  draft: AgentChatComposerDraft,
  context: RunningTurnSteerContext,
): string | null =>
  runningTurnSteerBlockedReason(
    {
      parts: draft.segments.filter(
        (segment) =>
          segment.kind !== "slash_command" || !isReusablePromptSlashCommand(segment.command),
      ),
      attachments: draft.attachments ?? [],
    },
    context,
  );

/**
 * Why Steer now cannot send this queued message, or null. Blocking input stops steering first.
 * Other limits apply only to a running turn, because an idle session takes the message as a new
 * turn.
 */
export const queuedMessageSteerBlockedReason = (
  entry: Pick<AgentQueuedMessage, "parts">,
  context: QueuedMessageSteerContext,
): string | null => {
  if (context.isWaitingInput) return BLOCKED_ON_INPUT_REASON;
  if (!composerForegroundTurnActive(context)) return null;
  return runningTurnSteerBlockedReason(
    {
      parts: entry.parts,
      attachments: entry.parts.flatMap((part) =>
        part.kind === "attachment" ? [part.attachment] : [],
      ),
    },
    context,
  );
};
