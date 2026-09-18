import type { FileDiff } from "@openducktor/contracts";
import type { DiffLineAnnotation, SelectedLineRange } from "@pierre/diffs";
import { type ReactElement, useCallback, useEffect, useMemo, useReducer } from "react";
import { z } from "zod";
import type { PierreDiffSelection } from "@/components/features/agents/pierre-diff-viewer";
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

type FileDiffAnnotationState = {
  selectedLines: SelectedLineRange | null;
  pendingSelection: PierreDiffSelection | null;
  editingCommentId: string | null;
};

type FileDiffAnnotationAction =
  | { type: "reset" }
  | { type: "selectionCleared" }
  | { type: "selectionChanged"; selection: PierreDiffSelection | null }
  | { type: "editingStarted"; commentId: string }
  | { type: "editingCanceled" };

const fileDiffAnnotationReducer = (
  state: FileDiffAnnotationState,
  action: FileDiffAnnotationAction,
): FileDiffAnnotationState => {
  switch (action.type) {
    case "reset":
      return {
        selectedLines: null,
        pendingSelection: null,
        editingCommentId: null,
      };
    case "selectionCleared":
      return { ...state, selectedLines: null, pendingSelection: null };
    case "selectionChanged":
      return {
        ...state,
        pendingSelection: action.selection,
        selectedLines: action.selection?.selectedLines ?? null,
      };
    case "editingStarted":
      return {
        selectedLines: null,
        pendingSelection: null,
        editingCommentId: action.commentId,
      };
    case "editingCanceled":
      return { ...state, editingCommentId: null };
  }
};

const mapCommentSideToAnnotationSide = (
  side: InlineCommentDraft["side"],
): "additions" | "deletions" => {
  return side === "old" ? "deletions" : "additions";
};

type UseFileDiffCommentAnnotationsArgs = {
  ownerKey: string | null;
  diff: FileDiff;
  diffScope: DiffScope;
  fileComments: InlineCommentDraft[];
};

type FileDiffCommentAnnotations = {
  selectedLines: SelectedLineRange | null;
  hasOpenAnnotationForm: boolean;
  handleLineSelectionEnd: (selection: PierreDiffSelection | null) => void;
  lineAnnotations: DiffLineAnnotation<GitDiffCommentAnnotationMetadata>[];
  renderAnnotation: (annotation: DiffLineAnnotation<unknown>) => ReactElement | null;
};

export function useFileDiffCommentAnnotations({
  ownerKey,
  diff,
  diffScope,
  fileComments,
}: UseFileDiffCommentAnnotationsArgs): FileDiffCommentAnnotations {
  const { addComment, updateComment, removeComment } = useOwnerScopedCommentActions(ownerKey);
  const [annotationState, dispatchAnnotation] = useReducer(fileDiffAnnotationReducer, {
    selectedLines: null,
    pendingSelection: null,
    editingCommentId: null,
  });
  const { selectedLines, pendingSelection, editingCommentId } = annotationState;
  const annotationResetKey = `${ownerKey ?? ""}:${diffScope}:${diff.diff}`;

  useEffect(() => {
    void annotationResetKey;
    dispatchAnnotation({ type: "reset" });
  }, [annotationResetKey]);

  const clearPendingSelection = useCallback(() => {
    dispatchAnnotation({ type: "selectionCleared" });
  }, []);

  const handleLineSelectionEnd = useCallback((selection: PierreDiffSelection | null) => {
    dispatchAnnotation({ type: "selectionChanged", selection });
  }, []);

  const handleStartEditing = useCallback((comment: InlineCommentDraft) => {
    dispatchAnnotation({ type: "editingStarted", commentId: comment.id });
  }, []);

  const handleCancelEditing = useCallback(() => {
    dispatchAnnotation({ type: "editingCanceled" });
  }, []);

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
    [updateComment],
  );

  const lineAnnotations = useMemo<DiffLineAnnotation<GitDiffCommentAnnotationMetadata>[]>(() => {
    const commentAnnotations = fileComments.map((comment) => ({
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
  }, [fileComments, pendingSelection]);

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
            <NewCommentForm onCancel={clearPendingSelection} onSave={handleSaveNewComment} />
          </DiffAnnotationShell>
        );
      }

      const comment = commentsById.get(metadata.commentId);
      if (!comment) {
        return null;
      }

      return (
        <DiffAnnotationShell>
          <DraftCommentCard
            comment={comment}
            isEditing={activeEditingCommentId === comment.id}
            onStartEditing={handleStartEditing}
            onCancelEditing={handleCancelEditing}
            onSaveEditing={handleSaveEditing}
            onRemove={removeComment}
          />
        </DiffAnnotationShell>
      );
    },
    [
      clearPendingSelection,
      commentsById,
      activeEditingCommentId,
      handleCancelEditing,
      handleSaveEditing,
      handleSaveNewComment,
      handleStartEditing,
      pendingSelection,
      removeComment,
    ],
  );

  return {
    selectedLines,
    hasOpenAnnotationForm,
    handleLineSelectionEnd,
    lineAnnotations,
    renderAnnotation,
  };
}
