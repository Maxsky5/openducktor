import type { DiffScopeState } from "../contracts";

export const createEmptyScopeState = (): DiffScopeState => ({
  branch: null,
  localChanges: null,
  gitConflict: null,
  fileDiffs: [],
  fileStatuses: [],
  uncommittedFileCount: 0,
  commitsAheadBehind: null,
  upstreamAheadBehind: null,
  upstreamStatus: "tracking",
  error: null,
  hashVersion: null,
  statusHash: null,
  diffHash: null,
});

/**
 * The state of a scope whose read failed. It keeps the identity fields of the last result, but no
 * content, so the view cannot show old changes as current.
 */
export const toFailedScopeState = (previous: DiffScopeState, error: string): DiffScopeState => ({
  ...previous,
  error,
  localChanges: null,
  fileDiffs: [],
  commitsAheadBehind: null,
  hashVersion: null,
  statusHash: null,
  diffHash: null,
});

/** Identifies the file statuses that a Git action reviewed. */
export const toStatusSnapshotKey = (state: DiffScopeState): string | null => {
  if (state.fileStatuses.length === 0) {
    return "<empty>";
  }
  if (state.hashVersion !== null && state.statusHash !== null) {
    return `${state.hashVersion}:${state.statusHash}`;
  }
  return state.fileStatuses
    .map((fileStatus) => `${fileStatus.path}:${fileStatus.status}:${fileStatus.staged ? 1 : 0}`)
    .join("|");
};
