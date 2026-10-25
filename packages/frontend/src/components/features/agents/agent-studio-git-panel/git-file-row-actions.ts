import type { GitFileDiff, GitChangeGroup } from "@openducktor/contracts";
import { type LucideIcon, Minus, Plus } from "lucide-react";
import type { GitChangeIntent } from "@openducktor/frontend-core/git/contracts";
import { gitChangeIntentKey } from "@openducktor/frontend-core/git/model/git-change-intent";

/** Write actions of one local group. Branch changes and conflicts have none. */
export type GitFileRowActions = {
  group: GitChangeGroup;
  /** Why the actions cannot run now, or null when they can. */
  disabledReason: string | null;
  onChange: (intent: GitChangeIntent) => void;
};

/**
 * Chunk actions need a text chunk that Git can apply alone. The host enforces the same rules in
 * `git-local-change-selection.ts`. Untracked files have the `added` type.
 */
export function chunkActionUnavailableReason(diff: GitFileDiff): string | null {
  if (diff.type === "submodule") return "Submodule changes have no text chunks.";
  if (diff.type === "added") return "New files change only as a whole file.";
  if (diff.type === "deleted") return "Deleted files change only as a whole file.";
  if (diff.type === "renamed") return "Renamed files change only as a whole file.";
  if (!/^@@ /mu.test(diff.diff)) {
    return "This change has no text chunks, for example a binary file.";
  }
  return null;
}

/** Edits inside a submodule that stays on its recorded commit. Git shows them with `-dirty`. */
const SUBMODULE_EDITS_ONLY = /^-Subproject commit ([0-9a-f]+)\n\+Subproject commit \1-dirty$/mu;

/**
 * Discard cannot change the commit that a submodule has checked out, or the files inside it. The
 * host refuses it with the same reasons in `git-local-change-selection.ts`.
 */
export function discardUnavailableReason(diff: GitFileDiff): string | null {
  if (diff.type !== "submodule") return null;
  return SUBMODULE_EDITS_ONLY.test(diff.diff)
    ? `${diff.file} has edits inside the submodule. Discard them inside the submodule, for example with \`git -C ${diff.file} restore .\`.`
    : `${diff.file} is a submodule. Discard cannot change the commit that the submodule has checked out. Run \`git submodule update -- ${diff.file}\` to check out the recorded commit, or unstage the change.`;
}

/** The action that moves content of a group to the other group. */
export const GROUP_TOGGLE = {
  unstaged: { action: "stage", label: "Stage", icon: Plus },
  staged: { action: "unstage", label: "Unstage", icon: Minus },
} satisfies Record<
  GitChangeGroup,
  { action: "stage" | "unstage"; label: string; icon: LucideIcon }
>;

/** Identifies an open diff of one list, because one path can show in two lists. */
export const listFileKey = (listKey: string, filePath: string): string =>
  JSON.stringify([listKey, filePath]);

export const fileIntent = (
  actions: Pick<GitFileRowActions, "group">,
  action: GitChangeIntent["action"],
  filePath: string,
): GitChangeIntent => ({ action, group: actions.group, selection: { kind: "file", filePath } });

/**
 * The file action of `filePath` that runs now, or null. A row compares this one value, so a change
 * of another file does not draw the row again.
 */
export function runningFileAction(
  group: GitChangeGroup,
  filePath: string,
  changingKey: string | null,
): GitChangeIntent["action"] | null {
  if (changingKey === null) return null;
  for (const action of [GROUP_TOGGLE[group].action, "discard"] as const) {
    if (gitChangeIntentKey(fileIntent({ group }, action, filePath)) === changingKey) return action;
  }
  return null;
}

export const discardFileLabel = (group: GitChangeGroup): string =>
  group === "staged" ? "Discard staged changes" : "Discard unstaged changes";
