import { useCallback, useEffect, useMemo } from "react";
import type {
  AgentChatComposerModel,
  AgentChatQueuedSendContent,
} from "@/components/features/agents/agent-chat/agent-chat.types";
import {
  type AgentChatComposerDraft,
  appendTextToDraft,
} from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import {
  type AgentChatDraftScope,
  didAgentChatDraftScopeSwitchSessionOnly,
} from "@/components/features/agents/agent-chat/agent-chat-draft-scope";
import {
  type InlineCommentDraftStore,
  useInlineCommentDraftStore,
} from "@/state/use-inline-comment-draft-store";

export type AgentStudioReviewCommentStore = Pick<
  InlineCommentDraftStore,
  | "drafts"
  | "getPendingDrafts"
  | "formatBatchMessage"
  | "beginSubmittingDrafts"
  | "restoreSubmittingDrafts"
  | "completeSubmittingDrafts"
  | "setDraftStateKey"
  | "resetForContext"
>;

type AgentStudioReviewCommentComposerAdapter = {
  syncDraftScope: (draftScope: AgentChatDraftScope, draftStateKey: string) => void;
  submitDraft: (
    draft: AgentChatComposerDraft,
    onSend: AgentChatComposerModel["onSend"],
  ) => Promise<boolean>;
};

export const createAgentStudioReviewCommentComposerAdapter = (
  getStore: () => AgentStudioReviewCommentStore,
): AgentStudioReviewCommentComposerAdapter => {
  let previousDraftScope: AgentChatDraftScope | null = null;

  return {
    syncDraftScope: (draftScope, draftStateKey) => {
      if (previousDraftScope === draftScope) {
        return;
      }

      const store = getStore();
      if (
        previousDraftScope !== null &&
        didAgentChatDraftScopeSwitchSessionOnly(previousDraftScope, draftScope) &&
        store.drafts.some((draft) => draft.status === "submitting")
      ) {
        store.setDraftStateKey(draftStateKey);
      } else {
        store.resetForContext(draftStateKey);
      }

      previousDraftScope = draftScope;
    },
    submitDraft: async (draft, onSend) => {
      const store = getStore();
      const pendingDrafts = store.getPendingDrafts();
      const submittingDrafts = pendingDrafts.map((pendingDraft) => ({
        id: pendingDraft.id,
        revision: pendingDraft.revision,
      }));
      const commentAppendix = store.formatBatchMessage(pendingDrafts);
      const nextDraft =
        commentAppendix.length > 0 ? appendTextToDraft(draft, commentAppendix) : draft;
      const submissionId = store.beginSubmittingDrafts(submittingDrafts);

      try {
        const didSend = await onSend(nextDraft);
        if (!submissionId) {
          return didSend;
        }

        if (didSend) {
          getStore().completeSubmittingDrafts(submissionId);
        } else {
          getStore().restoreSubmittingDrafts(submissionId);
        }
        return didSend;
      } catch (error) {
        if (submissionId) {
          getStore().restoreSubmittingDrafts(submissionId);
        }
        throw error;
      }
    },
  };
};

type UseAgentStudioReviewCommentComposerAdapterArgs = {
  draftScope: AgentChatDraftScope;
  draftStateKey: string;
  onSend: AgentChatComposerModel["onSend"];
};

type UseAgentStudioReviewCommentComposerAdapterResult = {
  queuedSendContent: AgentChatQueuedSendContent | null;
  onSend: AgentChatComposerModel["onSend"];
};

export function useAgentStudioReviewCommentComposerAdapter({
  draftScope,
  draftStateKey,
  onSend,
}: UseAgentStudioReviewCommentComposerAdapterArgs): UseAgentStudioReviewCommentComposerAdapterResult {
  const queuedCommentCount = useInlineCommentDraftStore((store) => store.getDraftCount());
  const adapter = useMemo(
    () =>
      createAgentStudioReviewCommentComposerAdapter(() => useInlineCommentDraftStore.getState()),
    [],
  );

  useEffect(() => {
    adapter.syncDraftScope(draftScope, draftStateKey);
  }, [adapter, draftScope, draftStateKey]);

  const submitDraft = useCallback(
    (draft: AgentChatComposerDraft): Promise<boolean> => adapter.submitDraft(draft, onSend),
    [adapter, onSend],
  );
  const queuedSendContent = useMemo<AgentChatQueuedSendContent | null>(() => {
    if (queuedCommentCount <= 0) {
      return null;
    }

    const commentLabel = queuedCommentCount === 1 ? "comment" : "comments";
    return {
      count: queuedCommentCount,
      accessibleLabel: `${queuedCommentCount} queued review ${commentLabel}`,
    };
  }, [queuedCommentCount]);

  return useMemo(
    () => ({
      queuedSendContent,
      onSend: submitDraft,
    }),
    [queuedSendContent, submitDraft],
  );
}
