import type { InlineCommentDraft } from "@openducktor/frontend-core/drafts/inline-comment-draft-store";
import { placeLocalComments } from "@openducktor/frontend-core/drafts/inline-comment-placement";
import type { DiffDataState } from "@openducktor/frontend-core/git/contracts";
import { changedFileKey } from "./changes-model";
import { commentMatchesRows } from "./diff-comment-model";
import { prepareFileDiff } from "./prepared-diff";

const LOCAL_GROUPS = ["conflicted", "unstaged", "staged"] as const;

/**
 * The comments of each changed file, by `changedFileKey`, as on desktop. A Branch changes file
 * shows the target comments of its path. An uncommitted comment shows in one local group, so a
 * partly staged file shows it once: in the group whose diff still holds its lines, or else in the
 * first group with the file.
 */
export const changedFileComments = (
  diffData: DiffDataState,
  drafts: readonly InlineCommentDraft[],
): ReadonlyMap<string, InlineCommentDraft[]> => {
  const byFile = new Map<string, InlineCommentDraft[]>();
  for (const draft of drafts) {
    if (draft.diffScope !== "target") continue;
    const key = changedFileKey("target", draft.filePath);
    const comments = byFile.get(key);
    if (comments) comments.push(draft);
    else byFile.set(key, [draft]);
  }
  const local = diffData.scopeStatesByScope.uncommitted.localChanges;
  if (!local) return byFile;
  const placed = placeLocalComments(
    drafts,
    LOCAL_GROUPS.map((group) => ({ group, fileDiffs: local[group].fileDiffs })),
    (diff, draft, group) => commentMatchesRows(prepareFileDiff(diff, group).rows, draft),
  );
  for (const group of LOCAL_GROUPS) {
    for (const [path, comments] of placed[group]) byFile.set(changedFileKey(group, path), comments);
  }
  return byFile;
};
