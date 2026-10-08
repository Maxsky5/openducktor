import { useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";
import {
  type AgentChatComposerDraft,
  appendTextToDraft,
} from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import type { AgentChatSendResult } from "@/components/features/agents/agent-chat/agent-chat-send-result";
import type {
  AgentChatComposerModel,
  AgentChatPendingSendItems,
} from "@/components/features/agents/agent-chat/agent-chat.types";
import {
  type InlineCommentDraftStore,
  toInlineCommentDraftOwnerKey,
  useInlineCommentDraftStore,
} from "@/state/use-inline-comment-draft-store";
import type { InlineCommentOwner } from "@/types/inline-comment-owner";

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
}: {
  owner: InlineCommentOwner | null;
  onSend: AgentChatComposerModel["onSend"];
}): {
  pendingSendItems: AgentChatPendingSendItems | null;
  onSend: AgentChatComposerModel["onSend"];
} {
  const ownerKey = toInlineCommentDraftOwnerKey(owner);
  const count = useInlineCommentDraftStore((store) =>
    ownerKey === null ? 0 : store.getDraftCount(ownerKey),
  );
  const warning = useInlineCommentDraftStore((store) =>
    ownerKey === null ? null : store.getPersistenceWarning(ownerKey),
  );
  const pendingSendItems = useMemo<AgentChatPendingSendItems | null>(() => {
    if (count <= 0) return null;
    const items: AgentChatPendingSendItems = {
      count,
      accessibleLabel: `${count} pending review ${count === 1 ? "comment" : "comments"}`,
    };
    if (warning !== null) items.warning = PERSISTENCE_WARNINGS[warning];
    return items;
  }, [count, warning]);
  useEffect(() => {
    if (ownerKey !== null) useInlineCommentDraftStore.getState().hydrate(ownerKey);
  }, [ownerKey]);

  useEffect(() => {
    if (globalThis.window === undefined || globalThis.document === undefined) {
      return;
    }

    const flush = (): void => useInlineCommentDraftStore.getState().flush();
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") {
        flush();
      }
    };

    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flush();
    };
  }, []);

  const submitDraft = useCallback(
    (draft: AgentChatComposerDraft): Promise<AgentChatSendResult> =>
      sendReviewComments(ownerKey, draft, onSend, useInlineCommentDraftStore.getState),
    [onSend, ownerKey],
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
  onSend: AgentChatComposerModel["onSend"],
  getStore: () => ReviewCommentStore,
): Promise<AgentChatSendResult> {
  if (
    ownerKey === null ||
    draft.segments.some(
      (segment) => segment.kind === "slash_command" && segment.command.source === "system",
    )
  ) {
    return onSend(draft);
  }

  const store = getStore();
  const pending = store.getPendingDrafts(ownerKey);
  const revisions = pending.map(({ id, revision }) => ({ id, revision }));
  const comments = store.formatBatchMessage(pending);
  const message = comments.length > 0 ? appendTextToDraft(draft, comments) : draft;
  const submissionId = store.beginSubmittingDrafts(ownerKey, revisions);

  let accepted = false;
  try {
    const result = await onSend(message);
    if (!submissionId) {
      return result;
    }

    if (result === true) {
      accepted = true;
      getStore().completeSubmittingDrafts(submissionId);
      const warning = getStore().getPersistenceWarning(ownerKey);
      if (warning !== null)
        toast.error("Message sent, but the comment save failed", {
          description: PERSISTENCE_WARNINGS[warning],
        });
    } else {
      getStore().restoreSubmittingDrafts(submissionId);
    }
    return result;
  } catch (error) {
    if (accepted) {
      toast.error("Message sent, but comment cleanup failed", { description: String(error) });
      return true;
    }
    if (submissionId) {
      getStore().restoreSubmittingDrafts(submissionId);
    }
    throw error;
  }
}

const PERSISTENCE_WARNINGS = {
  oversized: "These comments are too large to save for later.",
  storage_unavailable: "These comments are not saved for this session.",
};
