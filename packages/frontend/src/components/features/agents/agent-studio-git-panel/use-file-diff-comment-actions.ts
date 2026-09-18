import { useCallback } from "react";
import {
  type AddInlineCommentDraftInput,
  useInlineCommentDraftStore,
} from "@/state/use-inline-comment-draft-store";

type OwnerScopedCommentActions = {
  addComment: (input: AddInlineCommentDraftInput) => void;
  updateComment: (commentId: string, text: string) => void;
  removeComment: (commentId: string) => void;
};

export function useOwnerScopedCommentActions(ownerKey: string | null): OwnerScopedCommentActions {
  const addDraft = useInlineCommentDraftStore((store) => store.addDraft);
  const updateDraft = useInlineCommentDraftStore((store) => store.updateDraft);
  const removeDraft = useInlineCommentDraftStore((store) => store.removeDraft);

  const addComment = useCallback(
    (input: AddInlineCommentDraftInput) => {
      if (ownerKey === null) {
        return;
      }
      addDraft(ownerKey, input);
    },
    [addDraft, ownerKey],
  );
  const updateComment = useCallback(
    (commentId: string, text: string) => {
      if (ownerKey === null) {
        return;
      }
      updateDraft(ownerKey, commentId, text);
    },
    [ownerKey, updateDraft],
  );
  const removeComment = useCallback(
    (commentId: string) => {
      if (ownerKey === null) {
        return;
      }
      removeDraft(ownerKey, commentId);
    },
    [ownerKey, removeDraft],
  );

  return { addComment, updateComment, removeComment };
}
