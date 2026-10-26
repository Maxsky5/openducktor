import type {
  AddInlineCommentDraftInput,
  InlineCommentDraft,
} from "@openducktor/frontend-core/drafts/inline-comment-draft-store";
import { type ReactElement, useCallback, useReducer } from "react";
import { View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useFeedbackStore } from "@/app-shell/app-services";
import { languageForFilePath } from "@/rich-content/code/highlight";
import { type DiffLineRow, type DiffRow, diffLineTarget } from "@/rich-content/diff/diff-row-model";
import { useAppTheme } from "@/theme/app-theme-context";
import { motion } from "@/theme/tokens";
import { Button } from "@/ui/button";
import { useConfirm } from "@/ui/confirm-dialog";
import { haptics } from "@/ui/haptics";
import { IconButton } from "@/ui/icon-button";
import { useBottomEdgePadding } from "@/ui/keyboard-inset-view";
import { Text } from "@/ui/text";
import { useAnnounce } from "@/ui/use-announce";
import { CommentComposer } from "./comment-composer";
import {
  type CommentComposerState,
  type CommentFile,
  diffCommentFlowReducer,
  type FileLineSelection,
  INITIAL_DIFF_COMMENT_FLOW,
  newCommentComposer,
  newCommentInput,
} from "./diff-comment-flow-model";
import { selectionLabel } from "./diff-comment-model";

export type DiffCommentFlow = {
  selection: FileLineSelection | null;
  composer: CommentComposerState | null;
  /** Selects a line, or extends the selection of its file. A line of another file starts again. */
  selectLine: (file: CommentFile, row: DiffLineRow) => void;
  clearSelection: () => void;
  /**
   * Ends the selection when its diff leaves the screen: the diff of `fileKey`, or every diff for
   * null. A comment that is being written keeps its selection.
   */
  hideDiff: (fileKey: string | null) => void;
  startComment: () => void;
  editComment: (comment: InlineCommentDraft) => void;
  removeComment: (comment: InlineCommentDraft) => void;
  saveComment: (text: string) => void;
  cancelComposer: () => void;
};

/**
 * The Inline Diff Comment flow of one or more file diffs: tap a line to select it, tap another
 * line of the same side to extend the range, then write the comment in the bottom composer.
 * `rowsOf` gives the diff rows of a file, so a new comment captures its code context.
 */
export function useDiffCommentFlow({
  rowsOf,
  addComment,
  updateComment,
  removeComment,
}: {
  rowsOf: (fileKey: string) => readonly DiffRow[] | null;
  addComment: (input: AddInlineCommentDraftInput) => void;
  updateComment: (commentId: string, text: string) => void;
  removeComment: (commentId: string) => void;
}): DiffCommentFlow {
  const confirm = useConfirm();
  const { feedback } = useFeedbackStore();
  const [{ selection, composer }, dispatch] = useReducer(
    diffCommentFlowReducer,
    INITIAL_DIFF_COMMENT_FLOW,
  );
  const composing = composer !== null;

  const selectLine = useCallback(
    (file: CommentFile, row: DiffLineRow) => {
      const target = diffLineTarget(row);
      // While a comment is written, its lines stay fixed.
      if (!target || composing) return;
      haptics.selection();
      dispatch({ type: "line_tapped", file, target });
    },
    [composing],
  );
  const clearSelection = useCallback(() => dispatch({ type: "selection_cleared" }), []);
  const hideDiff = useCallback(
    (fileKey: string | null) => dispatch({ type: "diff_hidden", fileKey }),
    [],
  );
  const startComment = useCallback(() => {
    if (!selection) return;
    const next = newCommentComposer(selection, rowsOf(selection.fileKey));
    if (next) {
      dispatch({ type: "composer_opened", composer: next });
      return;
    }
    // A new read moved or changed the selected lines, so their code is unknown.
    dispatch({ type: "selection_cleared" });
    feedback.show("error", "The diff changed. Select the lines again.");
  }, [feedback, rowsOf, selection]);
  const editComment = useCallback((comment: InlineCommentDraft) => {
    dispatch({ type: "composer_opened", composer: { mode: "edit", comment } });
  }, []);
  const remove = useCallback(
    (comment: InlineCommentDraft) => {
      void confirm({
        title: "Remove Comment?",
        message: "The comment does not go with the next message.",
        confirmLabel: "Remove",
        destructive: true,
      }).then((confirmed) => {
        if (confirmed) removeComment(comment.id);
      });
    },
    [confirm, removeComment],
  );
  const saveComment = useCallback(
    (text: string) => {
      if (composer === null) return;
      if (composer.mode === "edit") {
        if (text.trim().length > 0) updateComment(composer.comment.id, text.trim());
        dispatch({ type: "composer_closed" });
        return;
      }
      const input = newCommentInput(composer, text, languageForFilePath(composer.selection.path));
      // Empty text gives no comment, and the composer disables Save for it.
      if (!input) return;
      addComment(input);
      dispatch({ type: "comment_saved" });
    },
    [addComment, composer, updateComment],
  );
  const cancelComposer = useCallback(() => dispatch({ type: "composer_closed" }), []);
  return {
    selection,
    composer,
    selectLine,
    clearSelection,
    hideDiff,
    startComment,
    editComment,
    removeComment: remove,
    saveComment,
    cancelComposer,
  };
}

/**
 * The bottom bar of a comment flow: the composer while a comment is written, or the selected
 * lines with the Comment action while lines are selected. Put it under the list, in a view that
 * stays above the keyboard.
 */
export function DiffCommentBar({
  flow,
  recipientLabel,
}: {
  flow: DiffCommentFlow;
  recipientLabel: "Builder" | "agent";
}): ReactElement | null {
  const { composer, selection } = flow;
  const theme = useAppTheme();
  const edgePadding = useBottomEdgePadding(composer ? 0 : theme.space.xs);
  useAnnounce(selection && !composer ? selectionLabel(selection.lines) : null);
  if (composer) {
    return (
      <Animated.View style={[styles.composerEdge, edgePadding]}>
        <CommentComposer
          key={composer.mode === "edit" ? composer.comment.id : "new"}
          title={
            composer.mode === "edit"
              ? "Edit comment"
              : `Comment on ${selectionLabel(composer.selection.lines).toLowerCase()}`
          }
          initialText={composer.mode === "edit" ? composer.comment.text : ""}
          placeholder={
            recipientLabel === "Builder"
              ? "Add a comment for the Builder"
              : "Add a comment for this chat"
          }
          saveLabel={composer.mode === "edit" ? "Save" : "Comment"}
          editing={composer.mode === "edit"}
          onSave={flow.saveComment}
          onCancel={flow.cancelComposer}
        />
      </Animated.View>
    );
  }
  if (!selection) return null;
  const file = selection.path.slice(selection.path.lastIndexOf("/") + 1);
  return (
    // The bar fades in and out with the selection.
    <Animated.View
      entering={SELECTION_BAR_ENTERING}
      exiting={SELECTION_BAR_EXITING}
      style={[styles.selectionBar, edgePadding]}
      accessibilityLiveRegion="polite"
    >
      <IconButton
        icon="x"
        size={20}
        color="secondaryLabel"
        accessibilityLabel="Clear the line selection"
        onPress={flow.clearSelection}
      />
      <View style={styles.selectionText}>
        <Text variant="subhead" weight="medium" numberOfLines={1}>
          {selectionLabel(selection.lines)}
        </Text>
        <Text variant="monoSmall" numberOfLines={1} ellipsizeMode="middle" style={styles.file}>
          {file}
        </Text>
      </View>
      <Button
        label="Comment"
        icon="message-square-plus"
        size="sm"
        variant="filled"
        onPress={flow.startComment}
        accessibilityHint="Writes a comment on the selected lines."
      />
    </Animated.View>
  );
}

const SELECTION_BAR_ENTERING = FadeIn.duration(motion.fast);
const SELECTION_BAR_EXITING = FadeOut.duration(motion.press);

const styles = StyleSheet.create((theme) => ({
  selectionBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.xs,
    paddingLeft: theme.space.xs,
    paddingRight: theme.space.md,
    paddingVertical: theme.space.xs,
    borderTopWidth: theme.hairline,
    borderTopColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
  },
  composerEdge: { backgroundColor: theme.colors.background },
  selectionText: { flex: 1, minWidth: 0 },
  file: { color: theme.desktop.mutedForeground },
}));
