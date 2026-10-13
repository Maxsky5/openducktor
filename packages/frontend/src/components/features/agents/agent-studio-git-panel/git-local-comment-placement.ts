import type { GitFileDiff } from "@openducktor/contracts";
import { commentMatchesDiff } from "@/components/features/agents/pierre-diff-viewer-model";
import type { InlineCommentDraft } from "@/state/use-inline-comment-draft-store";

export type LocalCommentGroup = "conflicted" | "unstaged" | "staged";

/** The comments that each local group shows, by file path. */
export type PlacedLocalComments = {
  conflicted: Map<string, InlineCommentDraft[]>;
  unstaged: Map<string, InlineCommentDraft[]>;
  staged: Map<string, InlineCommentDraft[]>;
};

/**
 * Shows each uncommitted comment in one local group. The first group whose diff still holds the
 * commented text gets it. Otherwise the first group with the file shows it as a file comment.
 */
export function placeLocalComments(
  drafts: readonly InlineCommentDraft[],
  groups: readonly { group: LocalCommentGroup; fileDiffs: readonly GitFileDiff[] }[],
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
    const candidates = diffsByGroup.filter(({ byPath }) => byPath.has(draft.filePath));
    const match =
      candidates.find(({ byPath }) =>
        commentMatchesDiff(byPath.get(draft.filePath)?.diff ?? "", draft.filePath, draft),
      ) ?? candidates[0];
    if (!match) continue;
    const files = placed[match.group];
    const existing = files.get(draft.filePath);
    if (existing) existing.push(draft);
    else files.set(draft.filePath, [draft]);
  }
  return placed;
}
