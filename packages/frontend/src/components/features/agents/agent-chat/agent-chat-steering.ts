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

export type QueuedMessageSteerContext = Pick<
  AgentChatComposerModel,
  | "steerBlockedReason"
  | "runningTurnModel"
  | "isSessionWorking"
  | "foregroundTurnActive"
  | "isWaitingInput"
>;

/** An idle session takes a steer as a new turn, so steering limits apply only to a running turn. */
export const steersRunningTurn = (mode: AgentMessageSubmitMode, turnActive: boolean): boolean =>
  mode === "steer" && turnActive;

export const hasForegroundTurn = (
  context: Pick<AgentChatComposerModel, "foregroundTurnActive" | "isSessionWorking">,
): boolean => context.foregroundTurnActive ?? context.isSessionWorking;

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

export const queuedMessageSteerBlockedReason = (
  entry: Pick<AgentQueuedMessage, "parts">,
  context: QueuedMessageSteerContext,
): string | null => {
  if (context.isWaitingInput) return BLOCKED_ON_INPUT_REASON;
  if (!hasForegroundTurn(context)) return null;
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

type RunningTurnSteerContext = Pick<
  QueuedMessageSteerContext,
  "steerBlockedReason" | "runningTurnModel"
>;

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
