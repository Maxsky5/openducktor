import type {
  AddInlineCommentDraftInput,
  InlineCommentContextLine,
  InlineCommentDraft,
} from "@openducktor/frontend-core/drafts/inline-comment-draft-store";
import type { DiffScope } from "@openducktor/frontend-core/git/contracts";
import {
  type DiffLineRow,
  type DiffLineTarget,
  type DiffRow,
  diffLineTarget,
} from "@/rich-content/diff/diff-row-model";
import {
  commentCodeContext,
  type DiffLineSelection,
  isLineSelected,
  selectDiffLine,
} from "./diff-comment-model";

/** The file of a diff in a comment flow. */
export type CommentFile = { fileKey: string; path: string; diffScope: DiffScope };

/** The selected lines of one file. */
export type FileLineSelection = CommentFile & { lines: DiffLineSelection };

/**
 * The open composer. A new comment keeps its lines and their code context from the moment the
 * composer opens. Line taps, a collapsed file, or a new diff read then cannot change what it saves.
 */
export type CommentComposerState =
  | { mode: "new"; selection: FileLineSelection; codeContext: InlineCommentContextLine[] }
  | { mode: "edit"; comment: InlineCommentDraft };

export type NewCommentComposer = Extract<CommentComposerState, { mode: "new" }>;

export type DiffCommentFlowState = {
  selection: FileLineSelection | null;
  composer: CommentComposerState | null;
};

export const INITIAL_DIFF_COMMENT_FLOW: DiffCommentFlowState = { selection: null, composer: null };

export type DiffCommentFlowAction =
  | { type: "line_tapped"; file: CommentFile; target: DiffLineTarget }
  | { type: "selection_cleared" }
  /** The diff of one file left the screen, or the diffs of all files for a null `fileKey`. */
  | { type: "diff_hidden"; fileKey: string | null }
  | { type: "composer_opened"; composer: CommentComposerState }
  | { type: "composer_closed" }
  | { type: "comment_saved" };

/**
 * The Inline Diff Comment flow. A tap selects a line or extends the selection of its file, and a
 * line of another file starts again. While a comment is written, line taps do nothing, so the
 * lines of the comment stay fixed. A selection of a diff that leaves the screen ends.
 */
export const diffCommentFlowReducer = (
  state: DiffCommentFlowState,
  action: DiffCommentFlowAction,
): DiffCommentFlowState => {
  switch (action.type) {
    case "line_tapped": {
      if (state.composer !== null) return state;
      const current = state.selection;
      const same = current !== null && current.fileKey === action.file.fileKey;
      const lines = selectDiffLine(same ? current.lines : null, action.target);
      return { ...state, selection: lines === null ? null : { ...action.file, lines } };
    }
    case "selection_cleared":
      return state.selection === null ? state : { ...state, selection: null };
    case "diff_hidden": {
      const { selection } = state;
      if (state.composer !== null || selection === null) return state;
      if (action.fileKey !== null && selection.fileKey !== action.fileKey) return state;
      return { ...state, selection: null };
    }
    case "composer_opened":
      return { ...state, composer: action.composer };
    case "composer_closed":
      return { ...state, composer: null };
    case "comment_saved":
      return INITIAL_DIFF_COMMENT_FLOW;
  }
};

/** True when the line of `row` in the file `fileKey` is part of the selection. */
export const isRowSelected = (
  selection: FileLineSelection | null,
  fileKey: string,
  row: DiffLineRow,
): boolean =>
  selection !== null &&
  selection.fileKey === fileKey &&
  isLineSelected(selection.lines, diffLineTarget(row));

/**
 * The composer of a new comment on `selection`, with the code context from the current rows of
 * its file. Returns null when the rows are missing or no longer show the selected lines.
 */
export const newCommentComposer = (
  selection: FileLineSelection,
  rows: readonly DiffRow[] | null,
): NewCommentComposer | null => {
  const codeContext = commentCodeContext(rows, selection.lines);
  return codeContext ? { mode: "new", selection, codeContext } : null;
};

/** The comment that a new composer saves, or null for empty text. */
export const newCommentInput = (
  composer: NewCommentComposer,
  text: string,
  language: string | null,
): AddInlineCommentDraftInput | null => {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const { selection } = composer;
  return {
    filePath: selection.path,
    diffScope: selection.diffScope,
    startLine: selection.lines.startLine,
    endLine: selection.lines.endLine,
    side: selection.lines.side,
    text: trimmed,
    codeContext: composer.codeContext,
    language,
  };
};
