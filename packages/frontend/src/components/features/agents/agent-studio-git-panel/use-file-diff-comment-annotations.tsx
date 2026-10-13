import type { GitFileDiff } from "@openducktor/contracts";
import type { DiffLineAnnotation, SelectedLineRange } from "@pierre/diffs";
import { type ReactElement, useCallback, useMemo } from "react";
import { z } from "zod";
import type { PierreDiffSelection } from "@/components/features/agents/pierre-diff-viewer";
import { commentMatchesDiff } from "@/components/features/agents/pierre-diff-viewer-model";
import type { DiffScope } from "@/features/agent-studio-git";
import type { InlineCommentDraft } from "@/state/use-inline-comment-draft-store";
import { DiffAnnotationShell, DraftCommentCard, NewCommentForm } from "./file-diff-comments";
import { useOwnerScopedCommentActions } from "./use-file-diff-comment-actions";

type GitDiffCommentAnnotationMetadata =
  | { kind: "new-comment-form" }
  | { kind: "comment"; commentId: string };

const gitDiffCommentAnnotationMetadataSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new-comment-form") }),
  z.object({ kind: z.literal("comment"), commentId: z.string() }),
]);

export type FileDiffAnnotationState = {
  selectedLines: SelectedLineRange | null;
  pendingSelection: PierreDiffSelection | null;
  editingCommentId: string | null;
  newCommentText: string;
  editingText: string;
};

export type FileDiffAnnotationAction =
  | { type: "selectionCleared" }
  | { type: "selectionChanged"; selection: PierreDiffSelection | null }
  | { type: "newCommentTextChanged"; text: string }
  | { type: "editingStarted"; commentId: string; text: string }
  | { type: "editingTextChanged"; text: string }
  | { type: "editingCanceled" };

export const EMPTY_FILE_DIFF_ANNOTATION_STATE: FileDiffAnnotationState = {
  selectedLines: null,
  pendingSelection: null,
  editingCommentId: null,
  newCommentText: "",
  editingText: "",
};

export const fileDiffAnnotationReducer = (
  state: FileDiffAnnotationState,
  action: FileDiffAnnotationAction,
): FileDiffAnnotationState => {
  switch (action.type) {
    case "selectionCleared":
      return { ...state, selectedLines: null, pendingSelection: null, newCommentText: "" };
    case "selectionChanged":
      return {
        ...state,
        pendingSelection: action.selection,
        selectedLines: action.selection?.selectedLines ?? null,
      };
    case "editingStarted":
      return {
        ...EMPTY_FILE_DIFF_ANNOTATION_STATE,
        editingCommentId: action.commentId,
        editingText: action.text,
      };
    case "editingCanceled":
      return { ...state, editingCommentId: null, editingText: "" };
    case "newCommentTextChanged":
      return { ...state, newCommentText: action.text };
    case "editingTextChanged":
      return { ...state, editingText: action.text };
  }
};

const mapCommentSideToAnnotationSide = (
  side: InlineCommentDraft["side"],
): "additions" | "deletions" => {
  return side === "old" ? "deletions" : "additions";
};

type UseFileDiffCommentAnnotationsArgs = {
  ownerKey: string | null;
  commentPlaceholder?: string | undefined;
  diff: GitFileDiff;
  diffScope: DiffScope;
  fileComments: InlineCommentDraft[];
  annotationState: FileDiffAnnotationState;
  dispatchAnnotation: (action: FileDiffAnnotationAction) => void;
};

type FileDiffCommentAnnotations = {
  selectedLines: SelectedLineRange | null;
  hasOpenAnnotationForm: boolean;
  handleLineSelectionEnd: (selection: PierreDiffSelection | null) => void;
  lineAnnotations: DiffLineAnnotation<GitDiffCommentAnnotationMetadata>[];
  renderAnnotation: (annotation: DiffLineAnnotation<unknown>) => ReactElement | null;
  /** Comments whose captured lines this diff no longer holds. They stay pending for Send. */
  unplacedComments: InlineCommentDraft[];
  renderComment: (comment: InlineCommentDraft) => ReactElement;
};

export function useFileDiffCommentAnnotations({
  ownerKey,
  commentPlaceholder,
  diff,
  diffScope,
  fileComments,
  annotationState,
  dispatchAnnotation,
}: UseFileDiffCommentAnnotationsArgs): FileDiffCommentAnnotations {
  const { addComment, updateComment, removeComment } = useOwnerScopedCommentActions(ownerKey);
  const { selectedLines, pendingSelection, editingCommentId, newCommentText, editingText } =
    annotationState;

  const clearPendingSelection = useCallback(() => {
    dispatchAnnotation({ type: "selectionCleared" });
  }, [dispatchAnnotation]);

  const handleLineSelectionEnd = useCallback(
    (selection: PierreDiffSelection | null) => {
      dispatchAnnotation({ type: "selectionChanged", selection });
    },
    [dispatchAnnotation],
  );

  const handleStartEditing = useCallback(
    (comment: InlineCommentDraft) => {
      dispatchAnnotation({ type: "editingStarted", commentId: comment.id, text: comment.text });
    },
    [dispatchAnnotation],
  );

  const handleCancelEditing = useCallback(() => {
    dispatchAnnotation({ type: "editingCanceled" });
  }, [dispatchAnnotation]);

  const commentsById = useMemo(
    () => new Map(fileComments.map((comment) => [comment.id, comment])),
    [fileComments],
  );
  const editingComment =
    editingCommentId === null ? null : (commentsById.get(editingCommentId) ?? null);
  const activeEditingCommentId = editingComment?.status === "submitting" ? null : editingCommentId;
  const hasOpenAnnotationForm = pendingSelection != null || activeEditingCommentId != null;

  const handleSaveNewComment = useCallback(
    (text: string) => {
      const normalizedText = text.trim();
      if (!pendingSelection || normalizedText.length === 0) {
        return;
      }

      addComment({
        filePath: diff.file,
        diffScope,
        startLine: pendingSelection.startLine,
        endLine: pendingSelection.endLine,
        side: pendingSelection.side,
        text: normalizedText,
        codeContext: pendingSelection.codeContext,
        language: pendingSelection.language,
      });
      clearPendingSelection();
    },
    [addComment, clearPendingSelection, diff.file, diffScope, pendingSelection],
  );

  const handleSaveEditing = useCallback(
    (commentId: string, text: string) => {
      const normalizedText = text.trim();
      if (normalizedText.length === 0) {
        return;
      }

      updateComment(commentId, normalizedText);
      dispatchAnnotation({ type: "editingCanceled" });
    },
    [dispatchAnnotation, updateComment],
  );

  const { placedComments, unplacedComments } = useMemo(() => {
    const placed: InlineCommentDraft[] = [];
    const unplaced: InlineCommentDraft[] = [];
    for (const comment of fileComments) {
      (commentMatchesDiff(diff.diff, diff.file, comment) ? placed : unplaced).push(comment);
    }
    return { placedComments: placed, unplacedComments: unplaced };
  }, [diff.diff, diff.file, fileComments]);

  const lineAnnotations = useMemo<DiffLineAnnotation<GitDiffCommentAnnotationMetadata>[]>(() => {
    const commentAnnotations = placedComments.map((comment) => ({
      side: mapCommentSideToAnnotationSide(comment.side),
      lineNumber: comment.endLine,
      metadata: {
        kind: "comment",
        commentId: comment.id,
      } satisfies GitDiffCommentAnnotationMetadata,
    }));

    if (pendingSelection == null) {
      return commentAnnotations;
    }

    return [
      ...commentAnnotations,
      {
        side: mapCommentSideToAnnotationSide(pendingSelection.side),
        lineNumber: pendingSelection.endLine,
        metadata: {
          kind: "new-comment-form",
        } satisfies GitDiffCommentAnnotationMetadata,
      },
    ];
  }, [placedComments, pendingSelection]);

  const renderComment = useCallback(
    (comment: InlineCommentDraft): ReactElement => (
      <DraftCommentCard
        comment={comment}
        isEditing={activeEditingCommentId === comment.id}
        editingText={editingText}
        onEditingTextChange={(text) => dispatchAnnotation({ type: "editingTextChanged", text })}
        onStartEditing={handleStartEditing}
        onCancelEditing={handleCancelEditing}
        onSaveEditing={handleSaveEditing}
        onRemove={removeComment}
      />
    ),
    [
      activeEditingCommentId,
      dispatchAnnotation,
      editingText,
      handleCancelEditing,
      handleSaveEditing,
      handleStartEditing,
      removeComment,
    ],
  );

  const renderAnnotation = useCallback(
    (annotation: DiffLineAnnotation<unknown>): ReactElement | null => {
      const metadataResult = gitDiffCommentAnnotationMetadataSchema.safeParse(annotation.metadata);
      if (!metadataResult.success) {
        return null;
      }
      const metadata = metadataResult.data;
      if (metadata.kind === "new-comment-form") {
        if (pendingSelection == null) {
          return null;
        }

        return (
          <DiffAnnotationShell>
            <NewCommentForm
              placeholder={commentPlaceholder}
              value={newCommentText}
              onChange={(text) => dispatchAnnotation({ type: "newCommentTextChanged", text })}
              onCancel={clearPendingSelection}
              onSave={handleSaveNewComment}
            />
          </DiffAnnotationShell>
        );
      }

      const comment = commentsById.get(metadata.commentId);
      if (!comment) {
        return null;
      }

      return <DiffAnnotationShell>{renderComment(comment)}</DiffAnnotationShell>;
    },
    [
      clearPendingSelection,
      commentPlaceholder,
      dispatchAnnotation,
      commentsById,
      handleSaveNewComment,
      pendingSelection,
      newCommentText,
      renderComment,
    ],
  );

  return {
    selectedLines,
    hasOpenAnnotationForm,
    handleLineSelectionEnd,
    lineAnnotations,
    renderAnnotation,
    unplacedComments,
    renderComment,
  };
}
