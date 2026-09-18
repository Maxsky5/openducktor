import type { AgentChatSendResult } from "@/components/features/agents/agent-chat/agent-chat-send-result";
import { useCallback, useEffect, useMemo } from "react";
import type { AgentChatComposerModel } from "@/components/features/agents/agent-chat/agent-chat.types";
import {
  type AgentChatComposerDraft,
  appendTextToDraft,
} from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import {
  type InlineCommentDraftStore,
  type InlineCommentPersistenceWarning,
  toInlineCommentDraftOwnerKey,
  useInlineCommentDraftStore,
} from "@/state/use-inline-comment-draft-store";

export type AgentStudioReviewCommentStore = Pick<
  InlineCommentDraftStore,
  | "getPendingDrafts"
  | "formatBatchMessage"
  | "beginSubmittingDrafts"
  | "restoreSubmittingDrafts"
  | "completeSubmittingDrafts"
  | "hydrate"
  | "flush"
>;

type AgentStudioReviewCommentComposerAdapter = {
  hydrate: () => void;
  flush: () => void;
  submitDraft: (
    ownerKey: string | null,
    draft: AgentChatComposerDraft,
    onSend: AgentChatComposerModel["onSend"],
  ) => Promise<AgentChatSendResult>;
};

export const createAgentStudioReviewCommentComposerAdapter = (
  getStore: () => AgentStudioReviewCommentStore,
): AgentStudioReviewCommentComposerAdapter => ({
  hydrate: () => getStore().hydrate(),
  flush: () => getStore().flush(),
  submitDraft: async (ownerKey, draft, onSend) => {
    if (ownerKey === null) {
      return onSend(draft);
    }

    const store = getStore();
    const pendingDrafts = store.getPendingDrafts(ownerKey);
    const pendingDraftSnapshots = pendingDrafts.map((pendingDraft) => ({
      id: pendingDraft.id,
      revision: pendingDraft.revision,
    }));
    const commentAppendix = store.formatBatchMessage(pendingDrafts);
    const nextDraft =
      commentAppendix.length > 0 ? appendTextToDraft(draft, commentAppendix) : draft;
    const submissionId = store.beginSubmittingDrafts(ownerKey, pendingDraftSnapshots);

    try {
      const result = await onSend(nextDraft);
      if (!submissionId) {
        return result;
      }

      if (result === true) {
        getStore().completeSubmittingDrafts(submissionId);
      } else {
        getStore().restoreSubmittingDrafts(submissionId);
      }
      return result;
    } catch (error) {
      if (submissionId) {
        getStore().restoreSubmittingDrafts(submissionId);
      }
      throw error;
    }
  },
});

type UseAgentStudioReviewCommentComposerAdapterArgs = {
  workspaceId: string | null;
  taskId: string;
  onSend: AgentChatComposerModel["onSend"];
};

type UseAgentStudioReviewCommentComposerAdapterResult = {
  pendingInlineCommentCount: number;
  persistenceWarning: InlineCommentPersistenceWarning | null;
  onSend: AgentChatComposerModel["onSend"];
};

export function useAgentStudioReviewCommentComposerAdapter({
  workspaceId,
  taskId,
  onSend,
}: UseAgentStudioReviewCommentComposerAdapterArgs): UseAgentStudioReviewCommentComposerAdapterResult {
  const ownerKey = useMemo(
    () => toInlineCommentDraftOwnerKey({ workspaceId, taskId }),
    [taskId, workspaceId],
  );
  const pendingInlineCommentCount = useInlineCommentDraftStore((store) =>
    ownerKey === null ? 0 : store.getDraftCount(ownerKey),
  );
  const persistenceWarning = useInlineCommentDraftStore((store) =>
    ownerKey === null ? null : store.getPersistenceWarning(ownerKey),
  );
  const adapter = useMemo(
    () =>
      createAgentStudioReviewCommentComposerAdapter(() => useInlineCommentDraftStore.getState()),
    [],
  );

  useEffect(() => {
    adapter.hydrate();
  }, [adapter]);

  useEffect(() => {
    if (globalThis.window === undefined || globalThis.document === undefined) {
      return;
    }

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") {
        adapter.flush();
      }
    };

    window.addEventListener("pagehide", adapter.flush);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", adapter.flush);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      adapter.flush();
    };
  }, [adapter]);

  const submitDraft = useCallback(
    (draft: AgentChatComposerDraft): Promise<AgentChatSendResult> =>
      adapter.submitDraft(ownerKey, draft, onSend),
    [adapter, onSend, ownerKey],
  );

  return useMemo(
    () => ({
      pendingInlineCommentCount,
      persistenceWarning,
      onSend: submitDraft,
    }),
    [pendingInlineCommentCount, persistenceWarning, submitDraft],
  );
}
