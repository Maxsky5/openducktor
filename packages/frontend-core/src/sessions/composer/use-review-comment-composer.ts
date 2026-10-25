import type { AgentMessageSubmitMode } from "@openducktor/contracts";
import { useCallback, useEffect, useMemo } from "react";
import {
  type AgentChatComposerDraft,
  appendTextToDraft,
} from "../../drafts/agent-chat-composer-draft";
import type { AgentChatSendResult } from "../send/agent-chat-send-result";
import type { AgentChatPendingSendGroup, AgentChatSend } from "../send/agent-chat.types";
import type { ClientFeedback } from "../../platform/client-feedback";
import { type AppVisibility, subscribeAppHide } from "../../platform/app-visibility";
import { sendWithPendingItems } from "./agent-chat-pending-send";
import {
  type InlineCommentDraftStore,
  toInlineCommentDraftOwnerKey,
} from "../../drafts/inline-comment-draft-store";
import { useClientConnection } from "../../connection/client-connection-react";
import { useInlineCommentDraftStore } from "../../drafts/use-inline-comment-draft-store";
import type { InlineCommentOwner } from "../../drafts/inline-comment-owner";

export type ReviewCommentStore = Pick<
  InlineCommentDraftStore,
  | "getPendingDrafts"
  | "formatBatchMessage"
  | "beginSubmittingDrafts"
  | "restoreSubmittingDrafts"
  | "completeSubmittingDrafts"
  | "getPersistenceWarning"
>;

export function useReviewCommentComposer({
  owner,
  onSend,
  visibility,
}: {
  owner: InlineCommentOwner | null;
  onSend: AgentChatSend["onSend"];
  /** The comment drafts are written when the app hides, and also on unmount. */
  visibility: AppVisibility;
}): {
  pendingSendItems: AgentChatPendingSendGroup | null;
  onSend: AgentChatSend["onSend"];
} {
  const ownerKey = toInlineCommentDraftOwnerKey(owner);
  const { drafts, feedback } = useClientConnection();
  const inlineComments = drafts.inlineComments;
  const count = useInlineCommentDraftStore((store) =>
    ownerKey === null ? 0 : store.getDraftCount(ownerKey),
  );
  const warning = useInlineCommentDraftStore((store) =>
    ownerKey === null ? null : store.getPersistenceWarning(ownerKey),
  );
  const pendingSendItems = useMemo<AgentChatPendingSendGroup | null>(() => {
    if (count <= 0) return null;
    const items: AgentChatPendingSendGroup = {
      key: "review_comments",
      count,
      accessibleLabel: `${count} pending review ${count === 1 ? "comment" : "comments"}`,
    };
    if (warning !== null) items.warning = PERSISTENCE_WARNINGS[warning];
    return items;
  }, [count, warning]);
  useEffect(() => {
    if (ownerKey !== null) inlineComments.getState().hydrate(ownerKey);
  }, [inlineComments, ownerKey]);

  useEffect(() => {
    const flush = (): void => inlineComments.getState().flush();
    const stop = subscribeAppHide(visibility, flush);
    return () => {
      stop();
      flush();
    };
  }, [inlineComments, visibility]);

  const submitDraft = useCallback(
    (draft: AgentChatComposerDraft, mode: AgentMessageSubmitMode): Promise<AgentChatSendResult> =>
      sendReviewComments(ownerKey, draft, mode, onSend, inlineComments.getState, feedback),
    [feedback, inlineComments, onSend, ownerKey],
  );

  return useMemo(
    () => ({
      pendingSendItems,
      onSend: submitDraft,
    }),
    [pendingSendItems, submitDraft],
  );
}

/** System commands leave comments pending. Other sends reserve revisions until known acceptance. */
export async function sendReviewComments(
  ownerKey: string | null,
  draft: AgentChatComposerDraft,
  mode: AgentMessageSubmitMode,
  onSend: AgentChatSend["onSend"],
  getStore: () => ReviewCommentStore,
  feedback: ClientFeedback,
): Promise<AgentChatSendResult> {
  if (ownerKey === null) {
    return onSend(draft, mode);
  }

  return sendWithPendingItems(
    draft,
    mode,
    onSend,
    {
      itemName: "comment",
      lock: (current) => {
        const store = getStore();
        const pending = store.getPendingDrafts(ownerKey);
        const revisions = pending.map(({ id, revision }) => ({ id, revision }));
        const comments = store.formatBatchMessage(pending);
        return {
          message: comments.length > 0 ? appendTextToDraft(current, comments) : current,
          submissionId: store.beginSubmittingDrafts(ownerKey, revisions),
        };
      },
      complete: (submissionId) => {
        getStore().completeSubmittingDrafts(submissionId);
        const warning = getStore().getPersistenceWarning(ownerKey);
        if (warning !== null)
          feedback.show("error", "Message sent, but the comment save failed", {
            description: PERSISTENCE_WARNINGS[warning],
          });
      },
      restore: (submissionId) => getStore().restoreSubmittingDrafts(submissionId),
    },
    feedback,
  );
}

const PERSISTENCE_WARNINGS = {
  oversized: "These comments are too large to save for later.",
  storage_unavailable: "These comments are not saved for this session.",
};
