import type { GitFileDiff } from "@openducktor/contracts";
import type { InlineCommentContextLine, InlineCommentDraft } from "./inline-comment-draft-store";

/** One line of one side of a diff: a context line or a change of that side. */
export type InlineCommentSideLine = { lineNumber: number; text: string };

/** The context lines above and below a commented range. */
const INLINE_COMMENT_CONTEXT_RADIUS = 2;

/**
 * The code context of a comment on lines `startLine` to `endLine` of one diff side: the selected
 * lines with two lines of context on each side. `lines` holds the lines of that side in order.
 * Returns null when the side does not show the first or the last selected line.
 */
export const buildInlineCommentContext = (
  lines: readonly InlineCommentSideLine[],
  startLine: number,
  endLine: number,
): InlineCommentContextLine[] | null => {
  const startIndex = lines.findIndex((line) => line.lineNumber === startLine);
  const endIndex = lines.findIndex((line) => line.lineNumber === endLine);
  if (startIndex < 0 || endIndex < 0) return null;
  const contextStart = Math.max(0, startIndex - INLINE_COMMENT_CONTEXT_RADIUS);
  const contextEnd = Math.min(lines.length - 1, endIndex + INLINE_COMMENT_CONTEXT_RADIUS);
  return lines.slice(contextStart, contextEnd + 1).map((line, index) => ({
    lineNumber: line.lineNumber,
    text: line.text,
    isSelected: contextStart + index >= startIndex && contextStart + index <= endIndex,
  }));
};

/**
 * True when the commented lines still hold the captured text. `textByLine` holds the text of each
 * line on the side of the comment. A comment that fails this check must not attach to other
 * content at the same line numbers.
 */
export const inlineCommentMatchesLines = (
  textByLine: ReadonlyMap<number, string>,
  comment: Pick<InlineCommentDraft, "startLine" | "endLine" | "codeContext">,
): boolean => {
  const selected = comment.codeContext.filter((line) => line.isSelected);
  if (selected.length === 0) {
    return textByLine.has(comment.startLine) && textByLine.has(comment.endLine);
  }
  return selected.every((line) => textByLine.get(line.lineNumber) === line.text);
};

export type LocalCommentGroup = "conflicted" | "unstaged" | "staged";

/** The comments that each local group shows, by file path. */
export type PlacedLocalComments = {
  conflicted: Map<string, InlineCommentDraft[]>;
  unstaged: Map<string, InlineCommentDraft[]>;
  staged: Map<string, InlineCommentDraft[]>;
};

/**
 * Shows each uncommitted comment in one local group, so a partly staged file shows it once. The
 * first group whose diff still holds the commented text gets it. Otherwise the first group with
 * the file shows it as a comment whose lines changed. `matches` tells whether a diff of a group
 * still holds the commented text. It runs only for a file that is in more than one group.
 */
export function placeLocalComments(
  drafts: readonly InlineCommentDraft[],
  groups: readonly { group: LocalCommentGroup; fileDiffs: readonly GitFileDiff[] }[],
  matches: (diff: GitFileDiff, draft: InlineCommentDraft, group: LocalCommentGroup) => boolean,
): PlacedLocalComments {
  const placed: PlacedLocalComments = {
    conflicted: new Map(),
    unstaged: new Map(),
    staged: new Map(),
  };
  const diffsByGroup = groups.map(({ group, fileDiffs }) => ({
    group,
    byPath: new Map(fileDiffs.map((diff) => [diff.file, diff])),
  }));
  for (const draft of drafts) {
    if (draft.diffScope !== "uncommitted") continue;
    const candidates = diffsByGroup.flatMap(({ group, byPath }) => {
      const diff = byPath.get(draft.filePath);
      return diff ? [{ group, diff }] : [];
    });
    const match =
      candidates.length > 1
        ? (candidates.find(({ group, diff }) => matches(diff, draft, group)) ?? candidates[0])
        : candidates[0];
    if (!match) continue;
    const files = placed[match.group];
    const existing = files.get(draft.filePath);
    if (existing) existing.push(draft);
    else files.set(draft.filePath, [draft]);
  }
  return placed;
}
