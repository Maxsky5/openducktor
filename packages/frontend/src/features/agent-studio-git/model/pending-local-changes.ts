import type { FileStatus, GitFileDiff, GitLocalChanges } from "@openducktor/contracts";
import type { GitChangeIntent } from "../contracts";

type LocalGroup = GitLocalChanges["unstaged"];
/** The two groups after a move: the group that lost the files and the group that got them. */
type MovedGroups = { from: LocalGroup; to: LocalGroup };

const byPath = <T>(entries: T[], path: (entry: T) => string): T[] =>
  entries.toSorted((left, right) => path(left).localeCompare(path(right)));

/** A new file is untracked before Stage and added after it. Other statuses stay the same. */
const movedStatus = (status: FileStatus, staged: boolean): FileStatus => {
  let next = status.status;
  if (staged && next === "untracked") next = "added";
  if (!staged && next === "added") next = "untracked";
  return { ...status, status: next, staged };
};

/**
 * Moves whole files from one group to the other. A file that the other group already shows keeps
 * that entry, because only Git can join the two diffs. The next Git result replaces this guess.
 */
const moveFiles = (
  from: LocalGroup,
  to: LocalGroup,
  paths: ReadonlySet<string>,
  staged: boolean,
): MovedGroups => {
  const shown = new Set(to.fileStatuses.map((status) => status.path));
  const statuses: FileStatus[] = [];
  const diffs: GitFileDiff[] = [];
  for (const status of from.fileStatuses) {
    if (paths.has(status.path) && !shown.has(status.path)) {
      statuses.push(movedStatus(status, staged));
    }
  }
  for (const diff of from.fileDiffs) {
    if (paths.has(diff.file) && !shown.has(diff.file)) diffs.push(diff);
  }
  return {
    from: {
      ...from,
      fileStatuses: from.fileStatuses.filter((status) => !paths.has(status.path)),
      fileDiffs: from.fileDiffs.filter((diff) => !paths.has(diff.file)),
    },
    to: {
      ...to,
      fileStatuses: byPath([...to.fileStatuses, ...statuses], (status) => status.path),
      fileDiffs: byPath([...to.fileDiffs, ...diffs], (diff) => diff.file),
    },
  };
};

const applyChange = (changes: GitLocalChanges, intent: GitChangeIntent): GitLocalChanges => {
  const { action, selection } = intent;
  // Only Git can split a chunk, and Discard waits for its own confirmed result.
  if (action === "discard" || selection.kind === "hunk") return changes;
  const source = action === "stage" ? changes.unstaged : changes.staged;
  const paths = new Set(
    selection.kind === "all"
      ? source.fileStatuses.map((status) => status.path)
      : [selection.filePath],
  );
  if (action === "stage") {
    const moved = moveFiles(changes.unstaged, changes.staged, paths, true);
    return { ...changes, unstaged: moved.from, staged: moved.to };
  }
  const moved = moveFiles(changes.staged, changes.unstaged, paths, false);
  return { ...changes, staged: moved.from, unstaged: moved.to };
};

/**
 * The local changes with the Stage and Unstage requests that Git has not finished yet, so a
 * file moves at once. Snapshots stay as Git sent them, because a request must use real ones.
 */
export const applyPendingChanges = (
  changes: GitLocalChanges,
  pending: readonly GitChangeIntent[],
): GitLocalChanges => pending.reduce(applyChange, changes);
