import type { CommitsAheadBehind, GitCurrentBranch, GitFileDiff } from "@openducktor/contracts";
import type { DiffDataState, DiffScope } from "@openducktor/frontend-core/git/contracts";
import { emptyDiffCopy } from "@openducktor/frontend-core/git/model/empty-diff-copy";
import {
  type GitHeaderNotice,
  gitHeaderNotices,
} from "@openducktor/frontend-core/git/model/git-panel-header";
import type { TaskGitContextMode } from "@openducktor/frontend-core/git/task/task-worktree-paths";

/** The diff scopes of the Changes view, with the labels of the desktop Git panel tabs. */
export const CHANGES_SCOPE_OPTIONS: ReadonlyArray<{ value: DiffScope; label: string }> = [
  { value: "uncommitted", label: "Uncommitted changes" },
  { value: "target", label: "Branch changes" },
];

/** The group of a changed file. Uncommitted changes split as on desktop; target has one group. */
export type ChangedFileGroup = "conflicted" | "unstaged" | "staged" | "target";

/** The groups that a header can close. Conflicts always stay open, as on desktop. */
export type CollapsibleGroup = "unstaged" | "staged";

const CHANGE_GROUP_LABELS = {
  conflicted: "Conflicts",
  unstaged: "Unstaged",
  staged: "Staged",
  target: "Branch changes",
} satisfies Record<ChangedFileGroup, string>;

/** The text of a local group without files, as on desktop. */
export const EMPTY_GROUP_TEXT = {
  unstaged: "No unstaged changes",
  staged: "No staged changes",
} satisfies Record<CollapsibleGroup, string>;

/** The File Status of a changed file. Each status has a label, so color is never the only sign. */
export type FileStatusKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "submodule"
  | "conflicted";

export const FILE_STATUS_LABELS = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
  renamed: "Renamed",
  submodule: "Submodule",
  conflicted: "Conflicted",
} satisfies Record<FileStatusKind, string>;

export type ChangedFileItem = {
  kind: "file";
  key: string;
  group: ChangedFileGroup;
  path: string;
  name: string;
  directory: string | null;
  status: FileStatusKind;
  /** The Git change of the file. A conflicted file keeps its change type for its icon. */
  changeType: GitFileDiff["type"];
  additions: number;
  deletions: number;
};

type ChangesSectionItem = {
  kind: "section";
  key: string;
  group: ChangedFileGroup;
  title: string;
  count: number;
};

export type ChangesListItem = ChangesSectionItem | ChangedFileItem;

/** The diff scope of a group. Inline comments keep this scope. */
export const groupDiffScope = (group: ChangedFileGroup): DiffScope =>
  group === "target" ? "target" : "uncommitted";

/** A changed file in its group. */
export type ChangedFileRef = { group: ChangedFileGroup; path: string };

/** The key of a changed file in its group, for expanded diffs and selections. */
export const changedFileKey = (group: ChangedFileGroup, path: string): string => `${group}:${path}`;

/** The group and path of a key from `changedFileKey`. A group name holds no colon. */
export const parseChangedFileKey = (key: string): ChangedFileRef => {
  const separator = key.indexOf(":");
  const group = key.slice(0, separator);
  if (separator < 0 || !isChangedFileGroup(group)) {
    throw new Error(`${key} is not a changed file key.`);
  }
  return { group, path: key.slice(separator + 1) };
};

const splitPath = (path: string): { name: string; directory: string | null } => {
  const slash = path.lastIndexOf("/");
  return slash < 0
    ? { name: path, directory: null }
    : { name: path.slice(slash + 1), directory: path.slice(0, slash) };
};

const toFileItem = (group: ChangedFileGroup, diff: GitFileDiff): ChangedFileItem => ({
  kind: "file",
  key: changedFileKey(group, diff.file),
  group,
  path: diff.file,
  ...splitPath(diff.file),
  status: group === "conflicted" ? "conflicted" : diff.type,
  changeType: diff.type,
  additions: diff.additions,
  deletions: diff.deletions,
});

const section = (group: ChangedFileGroup, count: number): ChangesSectionItem => ({
  kind: "section",
  key: `section:${group}`,
  group,
  title: CHANGE_GROUP_LABELS[group],
  count,
});

/**
 * The rows of the changed file list. Uncommitted changes show the Conflicts group when it has
 * files, then the Unstaged and Staged groups, even when one is empty, as on desktop. A partly
 * staged file shows in both of its groups. Target changes show one list without groups.
 */
export const buildChangesItems = (diffData: DiffDataState, scope: DiffScope): ChangesListItem[] => {
  if (scope === "target") {
    return diffData.scopeStatesByScope.target.fileDiffs.map((diff) => toFileItem("target", diff));
  }
  const changes = diffData.scopeStatesByScope.uncommitted.localChanges;
  if (!changes) return [];
  const { conflicted, unstaged, staged } = changes;
  if (conflicted.fileDiffs.length + unstaged.fileDiffs.length + staged.fileDiffs.length === 0) {
    return [];
  }
  const items: ChangesListItem[] = [];
  if (conflicted.fileDiffs.length > 0) {
    items.push(section("conflicted", conflicted.fileDiffs.length));
    items.push(...conflicted.fileDiffs.map((diff) => toFileItem("conflicted", diff)));
  }
  items.push(section("unstaged", unstaged.fileDiffs.length));
  items.push(...unstaged.fileDiffs.map((diff) => toFileItem("unstaged", diff)));
  items.push(section("staged", staged.fileDiffs.length));
  items.push(...staged.fileDiffs.map((diff) => toFileItem("staged", diff)));
  return items;
};

/** The file count and line totals of a list, as the desktop list header. */
export type ChangesTotals = { fileCount: number; additions: number; deletions: number };

/**
 * The totals of the listed files. A file in two groups counts once in the file count and twice
 * in the line totals, as on desktop.
 */
export const changesTotals = (items: readonly ChangesListItem[]): ChangesTotals => {
  const paths = new Set<string>();
  let additions = 0;
  let deletions = 0;
  for (const item of items) {
    if (item.kind !== "file") continue;
    paths.add(item.path);
    additions += item.additions;
    deletions += item.deletions;
  }
  return { fileCount: paths.size, additions, deletions };
};

/** The diff of one changed file, or null when the current reads no longer list it. */
export const findChangedFileDiff = (
  diffData: DiffDataState,
  group: ChangedFileGroup,
  path: string,
): GitFileDiff | null => {
  if (group === "target") {
    return diffData.scopeStatesByScope.target.fileDiffs.find((diff) => diff.file === path) ?? null;
  }
  const changes = diffData.scopeStatesByScope.uncommitted.localChanges;
  return changes?.[group].fileDiffs.find((diff) => diff.file === path) ?? null;
};

/** The diff of each listed file of a scope, by `changedFileKey`. */
export const changedFileDiffs = (
  diffData: DiffDataState,
  scope: DiffScope,
): ReadonlyMap<string, GitFileDiff> => {
  const diffs = new Map<string, GitFileDiff>();
  const add = (group: ChangedFileGroup, list: readonly GitFileDiff[]): void => {
    for (const diff of list) diffs.set(changedFileKey(group, diff.file), diff);
  };
  if (scope === "target") {
    add("target", diffData.scopeStatesByScope.target.fileDiffs);
    return diffs;
  }
  const changes = diffData.scopeStatesByScope.uncommitted.localChanges;
  if (!changes) return diffs;
  add("conflicted", changes.conflicted.fileDiffs);
  add("unstaged", changes.unstaged.fileDiffs);
  add("staged", changes.staged.fileDiffs);
  return diffs;
};

export const isChangedFileGroup = (value: string): value is ChangedFileGroup =>
  value === "conflicted" || value === "unstaged" || value === "staged" || value === "target";

/** What the changed file list shows for a scope. */
export type ChangesScopeStatus =
  | { kind: "loading"; title: string }
  | { kind: "error"; title: string; message: string }
  | { kind: "unavailable"; title: string; message: string }
  | { kind: "empty"; title: string; message: string | null }
  | { kind: "ready" };

/**
 * What the changed file list shows, with the desktop texts. `contextMode` tells whether the
 * directory is the repository root, which compares with its upstream. `directoryProblem` tells
 * why Git cannot read the directory, such as a task worktree that failed to resolve. It shows
 * once the directory stops loading.
 */
export const changesScopeStatus = (
  diffData: DiffDataState,
  scope: DiffScope,
  {
    fileCount,
    contextMode,
    directoryProblem,
  }: {
    fileCount: number;
    contextMode: TaskGitContextMode;
    directoryProblem: string | null;
  },
): ChangesScopeStatus => {
  if (directoryProblem && !diffData.isLoading) {
    return { kind: "error", title: "Changes are unavailable", message: directoryProblem };
  }
  const state = diffData.scopeStatesByScope[scope];
  const loaded = diffData.loadedScopesByScope[scope];
  const copy = (isLoading: boolean) =>
    emptyDiffCopy({
      targetBranch: diffData.targetBranch,
      isLoading,
      contextMode,
      diffScope: scope,
      upstreamStatus: state.upstreamStatus,
    });
  if (scope === "target") {
    if (diffData.comparisonPending && !loaded) return { kind: "loading", title: copy(true).title };
    if (!diffData.comparisonReference && diffData.comparisonUnavailableReason) {
      return {
        kind: "unavailable",
        title: "Branch changes are unavailable",
        message: diffData.comparisonUnavailableReason,
      };
    }
  }
  if (state.error) {
    return {
      kind: "error",
      title: scope === "target" ? "Branch changes are unavailable" : "Changes could not load",
      message: state.error,
    };
  }
  if (!loaded) return { kind: "loading", title: copy(true).title };
  if (fileCount > 0) return { kind: "ready" };
  const { title, description } = copy(false);
  return { kind: "empty", title, message: description };
};

/**
 * The name of the current branch, or how Git describes a checkout without one. With no branch,
 * the label tells whether Git still reads it, as the desktop header does: a failed read must not
 * look like a read that never ends.
 */
export const currentBranchLabel = (
  branch: GitCurrentBranch | null,
  diffBranch: string | null,
  isLoading: boolean,
): string => {
  if (branch?.detached) {
    const revision = branch.revision?.slice(0, 7);
    return revision ? `Detached HEAD at ${revision}` : "Detached HEAD";
  }
  const name = branch?.name ?? diffBranch;
  if (name) return name;
  return isLoading ? "Reading branch..." : "Branch unavailable";
};

/** The target branch label of the desktop header. */
export const targetBranchLabel = (diffData: DiffDataState): string =>
  diffData.targetBranch.trim().length > 0 ? diffData.targetBranch : "No comparison target";

/**
 * The commit counts against the target. Desktop shows them only when the comparison is ready and
 * a count is above zero.
 */
export const shownTargetCounts = (diffData: DiffDataState): CommitsAheadBehind | null => {
  const counts = diffData.commitsAheadBehind;
  if (!counts || diffData.comparisonPending || diffData.comparisonUnavailableReason) return null;
  return counts.ahead > 0 || counts.behind > 0 ? counts : null;
};

/** What the header shows about the upstream of the current branch. */
export type UpstreamSummary =
  | { kind: "counts"; ahead: number; behind: number }
  | { kind: "unpublished"; ahead: number }
  | { kind: "none" };

/**
 * The upstream state of the checkout. Desktop shows the counts on its Pull and Push buttons, so a
 * branch in sync with its upstream shows nothing. An upstream error shows as a notice instead.
 */
export const upstreamSummary = (diffData: DiffDataState): UpstreamSummary => {
  const counts = diffData.upstreamAheadBehind;
  if (diffData.upstreamStatus === "untracked") {
    return { kind: "unpublished", ahead: counts?.ahead ?? 0 };
  }
  if (diffData.upstreamStatus !== "tracking" || !counts) return { kind: "none" };
  return counts.ahead > 0 || counts.behind > 0
    ? { kind: "counts", ahead: counts.ahead, behind: counts.behind }
    : { kind: "none" };
};

const commits = (count: number): string => `${count} ${count === 1 ? "commit" : "commits"}`;

/** The screen reader text of the target counts, as the desktop label. */
export const targetCountsLabel = (counts: CommitsAheadBehind, target: string): string =>
  `${commits(counts.ahead)} ahead of ${target}, ${counts.behind} behind`;

/** The screen reader text of the upstream state. */
export const upstreamLabel = (summary: UpstreamSummary): string | null => {
  switch (summary.kind) {
    case "counts":
      return `${commits(summary.ahead)} to push, ${commits(summary.behind)} to pull`;
    case "unpublished":
      return `No upstream branch yet, ${commits(summary.ahead)} to push`;
    case "none":
      return null;
  }
};

/**
 * The header notices of the Changes view. The view has no Git write actions, so it has no lock,
 * Detect PR, rebase, or push notice. The Branch changes list already explains a missing
 * comparison branch, so its tab does not repeat that notice.
 */
export const changesNotices = (
  diffData: DiffDataState,
  refreshError: string | null,
  scope: DiffScope,
): GitHeaderNotice[] =>
  gitHeaderNotices({
    detectPullRequestError: null,
    lockReason: null,
    refreshError,
    upstreamStatus: diffData.upstreamStatus,
    upstreamError: diffData.upstreamError ?? null,
    comparisonPending: diffData.comparisonPending ?? false,
    comparisonUnavailableReason:
      scope === "target" && !diffData.comparisonReference
        ? null
        : (diffData.comparisonUnavailableReason ?? null),
    rebaseError: null,
    pushError: null,
  });
