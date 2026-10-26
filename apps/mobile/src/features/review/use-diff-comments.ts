import type {
  AddInlineCommentDraftInput,
  InlineCommentDraft,
  InlineCommentDraftStore,
} from "@openducktor/frontend-core/drafts/inline-comment-draft-store";
import { toInlineCommentDraftOwnerKey } from "@openducktor/frontend-core/drafts/inline-comment-draft-store";
import type { InlineCommentOwner } from "@openducktor/frontend-core/drafts/inline-comment-owner";
import { useInlineCommentDraftStore } from "@openducktor/frontend-core/drafts/use-inline-comment-draft-store";
import type { DiffDataState } from "@openducktor/frontend-core/git/contracts";
import { useCallback, useMemo } from "react";
import { changedFileComments } from "./changed-file-comments";
import type { ChangesFocus } from "./changes-view-state";

const NO_DRAFTS: InlineCommentDraft[] = [];

/** Every inline comment of an owner. The store keeps one array for each owner revision. */
const useOwnerDrafts = (ownerKey: string | null): InlineCommentDraft[] => {
  const selectOwnerDrafts = useCallback(
    (store: InlineCommentDraftStore) =>
      ownerKey === null ? NO_DRAFTS : (store.draftsByOwner[ownerKey] ?? NO_DRAFTS),
    [ownerKey],
  );
  return useInlineCommentDraftStore(selectOwnerDrafts);
};

export type OwnerDiffComments = {
  /** The comments that each changed file shows, by `changedFileKey`. */
  commentsByFile: ReadonlyMap<string, InlineCommentDraft[]>;
  /** Every comment of the owner, by id. */
  commentsById: ReadonlyMap<string, InlineCommentDraft>;
  addComment: (input: AddInlineCommentDraftInput) => void;
  updateComment: (commentId: string, text: string) => void;
  removeComment: (commentId: string) => void;
};

/**
 * Every inline comment of an owner, by changed file of `diffData`. They live in the inline
 * comment drafts of the host connection, so they stay on the device for this host and go with the
 * next message to the agent.
 */
export function useOwnerDiffComments(
  owner: InlineCommentOwner,
  diffData: DiffDataState,
): OwnerDiffComments {
  const ownerKey = toInlineCommentDraftOwnerKey(owner);
  const ownerDrafts = useOwnerDrafts(ownerKey);
  const addDraft = useInlineCommentDraftStore((store) => store.addDraft);
  const updateDraft = useInlineCommentDraftStore((store) => store.updateDraft);
  const removeDraft = useInlineCommentDraftStore((store) => store.removeDraft);
  const commentsByFile = useMemo(
    () => changedFileComments(diffData, ownerDrafts),
    [diffData, ownerDrafts],
  );
  const commentsById = useMemo(
    () => new Map(ownerDrafts.map((draft) => [draft.id, draft])),
    [ownerDrafts],
  );
  const addComment = useCallback(
    (input: AddInlineCommentDraftInput) => {
      if (ownerKey !== null) addDraft(ownerKey, input);
    },
    [addDraft, ownerKey],
  );
  const updateComment = useCallback(
    (commentId: string, text: string) => {
      if (ownerKey !== null) updateDraft(ownerKey, commentId, text);
    },
    [ownerKey, updateDraft],
  );
  const removeComment = useCallback(
    (commentId: string) => {
      if (ownerKey !== null) removeDraft(ownerKey, commentId);
    },
    [ownerKey, removeDraft],
  );
  return { commentsByFile, commentsById, addComment, updateComment, removeComment };
}

/** The pending comment count of an owner, for Send feedback. */
/** The scope and file of the first pending comment of an owner, or null when it has none. */
export const usePendingCommentFocus = (owner: InlineCommentOwner | null): ChangesFocus | null => {
  const ownerKey = toInlineCommentDraftOwnerKey(owner);
  const first = useInlineCommentDraftStore((store) =>
    ownerKey === null ? null : (store.getPendingDrafts(ownerKey)[0] ?? null),
  );
  return useMemo(() => (first ? { scope: first.diffScope, path: first.filePath } : null), [first]);
};

export const usePendingCommentCount = (owner: InlineCommentOwner): number => {
  const ownerKey = toInlineCommentDraftOwnerKey(owner);
  return useInlineCommentDraftStore((store) =>
    ownerKey === null ? 0 : store.getPendingDrafts(ownerKey).length,
  );
};
