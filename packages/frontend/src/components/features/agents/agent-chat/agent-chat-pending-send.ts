import type { AgentMessageSubmitMode } from "@openducktor/contracts";
import { type AgentModelAttachmentSupport, readAttachmentValidationError } from "@openducktor/core";
import { toast } from "sonner";
import type {
  AgentChatComposerModel,
  AgentChatPendingSendAttachment,
  AgentChatPendingSendGroup,
} from "./agent-chat.types";
import {
  type AgentChatComposerDraft,
  draftHasSlashCommandSegment,
  draftHasSystemSlashCommand,
} from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import type { AgentChatSendResult } from "./agent-chat-send-result";

/** A store of pending items, such as review comments, that the next regular message carries. */
export type PendingSendSource = {
  /** Names one item in errors, for example "comment". */
  itemName: string;
  /** Adds the pending items to the draft and locks them. A null submission locked no item. */
  lock: (draft: AgentChatComposerDraft) => {
    message: AgentChatComposerDraft;
    submissionId: string | null;
  };
  complete: (submissionId: string) => void;
  restore: (submissionId: string) => void;
};

/**
 * Sends the draft with the pending items. The items stay locked until the send settles.
 * Acceptance clears them once, and every other result restores them. A system command does not
 * carry the items, so they stay pending.
 */
export async function sendWithPendingItems(
  draft: AgentChatComposerDraft,
  mode: AgentMessageSubmitMode,
  onSend: AgentChatComposerModel["onSend"],
  source: PendingSendSource,
): Promise<AgentChatSendResult> {
  if (draftHasSystemSlashCommand(draft)) return onSend(draft, mode);

  const { message, submissionId } = source.lock(draft);
  let accepted = false;
  try {
    const result = await onSend(message, mode);
    if (!submissionId) return result;

    if (result === true) {
      accepted = true;
      source.complete(submissionId);
    } else {
      source.restore(submissionId);
    }
    return result;
  } catch (error) {
    if (accepted) {
      toast.error(`Message sent, but ${source.itemName} cleanup failed`, {
        description: String(error),
      });
      return true;
    }
    if (submissionId) source.restore(submissionId);
    throw error;
  }
}

export const hasPendingSendItems = (
  groups: readonly AgentChatPendingSendGroup[] | undefined,
): boolean => (groups ?? []).some((group) => group.count > 0);

/**
 * The first problem of a pending group that blocks Send, or null. A system command, such as
 * `/compact`, does not carry the pending items, so their problems do not block it.
 */
export const readPendingSendBlockedReason = ({
  groups,
  draft,
  supportsAttachments,
  attachmentSupport,
}: {
  groups: readonly AgentChatPendingSendGroup[] | undefined;
  draft: AgentChatComposerDraft;
  supportsAttachments: boolean;
  attachmentSupport: AgentModelAttachmentSupport | null | undefined;
}): string | null => {
  if (draftHasSystemSlashCommand(draft)) return null;
  for (const group of groups ?? []) {
    if (group.count <= 0 || !group.attachments) continue;
    const error = readPendingAttachmentError(group.attachments.items, {
      draft,
      supportsAttachments,
      attachmentSupport,
    });
    if (error) return `${error} ${group.attachments.removalHint}`;
  }
  return null;
};

// Pending files follow the same rules as composer attachments.
const readPendingAttachmentError = (
  items: readonly AgentChatPendingSendAttachment[],
  {
    draft,
    supportsAttachments,
    attachmentSupport,
  }: {
    draft: AgentChatComposerDraft;
    supportsAttachments: boolean;
    attachmentSupport: AgentModelAttachmentSupport | null | undefined;
  },
): string | null => {
  if (items.length === 0) return null;
  if (!supportsAttachments) return "The selected runtime does not support attachments.";
  if (draftHasSlashCommandSegment(draft)) {
    return "Slash commands cannot send attachments.";
  }
  for (const item of items) {
    const error = readAttachmentValidationError(item, attachmentSupport);
    if (error) return error;
  }
  return null;
};
