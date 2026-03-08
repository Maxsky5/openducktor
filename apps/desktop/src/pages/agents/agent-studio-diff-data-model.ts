import type {
  CommitsAheadBehind,
  FileDiff,
  FileStatus,
  GitWorktreeStatus,
  GitWorktreeStatusSummary,
} from "@openducktor/contracts";

export type DiffDataState = {
  branch: string | null;
  worktreePath: string | null;
  targetBranch: string;
  diffScope: DiffScope;
  commitsAheadBehind: CommitsAheadBehind | null;
  upstreamAheadBehind: CommitsAheadBehind | null;
  upstreamStatus: "tracking" | "untracked" | "error";
  fileDiffs: FileDiff[];
  fileStatuses: FileStatus[];
  statusSnapshotKey?: string | null;
  uncommittedFileCount: number;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
  selectedFile: string | null;
  setSelectedFile: (path: string | null) => void;
  setDiffScope: (scope: DiffScope) => void;
};

export type DiffScope = "target" | "uncommitted";

export type UseAgentStudioDiffDataInput = {
  repoPath: string | null;
  sessionWorkingDirectory: string | null;
  sessionRunId: string | null;
  defaultTargetBranch: string;
  branchIdentityKey?: string | null;
  enablePolling: boolean;
  runCompletionRecoverySignal?: number;
};

export type DiffBatchState = {
  byScope: Record<DiffScope, ScopeSnapshot>;
  loadedByScope: Record<DiffScope, boolean>;
  isLoading: boolean;
};

export type ScopeSnapshot = {
  branch: string | null;
  fileDiffs: FileDiff[];
  fileStatuses: FileStatus[];
  uncommittedFileCount: number;
  commitsAheadBehind: CommitsAheadBehind | null;
  upstreamAheadBehind: CommitsAheadBehind | null;
  upstreamStatus: "tracking" | "untracked" | "error";
  error: string | null;
  hashVersion: number | null;
  statusHash: string | null;
  diffHash: string | null;
};

export type LoadDataMode = "full" | "summary";

export type ScopeSummaryFields = Pick<
  ScopeSnapshot,
  | "branch"
  | "uncommittedFileCount"
  | "commitsAheadBehind"
  | "upstreamAheadBehind"
  | "upstreamStatus"
  | "error"
  | "hashVersion"
  | "statusHash"
  | "diffHash"
>;

export type SummaryReloadDecision = {
  sharedHashesChanged: boolean;
  scopeHashesChanged: boolean;
  shouldReloadFullScope: boolean;
};

export const EMPTY_DIFFS: FileDiff[] = [];
export const EMPTY_STATUSES: FileStatus[] = [];

const EMPTY_SCOPE_SNAPSHOT: ScopeSnapshot = {
  branch: null,
  fileDiffs: EMPTY_DIFFS,
  fileStatuses: EMPTY_STATUSES,
  uncommittedFileCount: 0,
  commitsAheadBehind: null,
  upstreamAheadBehind: null,
  upstreamStatus: "tracking",
  error: null,
  hashVersion: null,
  statusHash: null,
  diffHash: null,
};

export const ALL_SCOPES: DiffScope[] = ["target", "uncommitted"];
export const ALL_LOAD_DATA_MODES: LoadDataMode[] = ["full", "summary"];

export const createInitialDiffBatchState = (): DiffBatchState => ({
  byScope: {
    target: EMPTY_SCOPE_SNAPSHOT,
    uncommitted: EMPTY_SCOPE_SNAPSHOT,
  },
  loadedByScope: {
    target: false,
    uncommitted: false,
  },
  isLoading: false,
});

const arraysEqual = <T>(a: T[], b: T[], areItemsEqual: (left: T, right: T) => boolean): boolean => {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }

  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === undefined || right === undefined) {
      return false;
    }
    if (!areItemsEqual(left, right)) {
      return false;
    }
  }

  return true;
};

const fileDiffEqual = (left: FileDiff, right: FileDiff): boolean =>
  left.file === right.file &&
  left.type === right.type &&
  left.additions === right.additions &&
  left.deletions === right.deletions &&
  left.diff === right.diff;

const fileStatusEqual = (left: FileStatus, right: FileStatus): boolean =>
  left.path === right.path && left.status === right.status && left.staged === right.staged;

const aheadBehindEqual = (
  left: CommitsAheadBehind | null,
  right: CommitsAheadBehind | null,
): boolean => {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.ahead === right.ahead && left.behind === right.behind;
};

const hashMetadataEqual = (left: ScopeSnapshot, right: ScopeSnapshot): boolean =>
  left.hashVersion === right.hashVersion &&
  left.statusHash === right.statusHash &&
  left.diffHash === right.diffHash;

export const scopeSnapshotEqual = (left: ScopeSnapshot, right: ScopeSnapshot): boolean => {
  const canUseHashShortCircuit =
    left.hashVersion !== null &&
    right.hashVersion !== null &&
    left.hashVersion === right.hashVersion &&
    left.statusHash !== null &&
    right.statusHash !== null &&
    left.diffHash !== null &&
    right.diffHash !== null;

  if (canUseHashShortCircuit) {
    const hashesMatch = left.statusHash === right.statusHash && left.diffHash === right.diffHash;
    const contentReferencesMatch =
      left.fileDiffs === right.fileDiffs && left.fileStatuses === right.fileStatuses;
    if (hashesMatch && left.error === right.error && contentReferencesMatch) {
      return true;
    }
  }

  return (
    left.branch === right.branch &&
    arraysEqual(left.fileDiffs, right.fileDiffs, fileDiffEqual) &&
    arraysEqual(left.fileStatuses, right.fileStatuses, fileStatusEqual) &&
    left.uncommittedFileCount === right.uncommittedFileCount &&
    aheadBehindEqual(left.commitsAheadBehind, right.commitsAheadBehind) &&
    aheadBehindEqual(left.upstreamAheadBehind, right.upstreamAheadBehind) &&
    left.upstreamStatus === right.upstreamStatus &&
    left.error === right.error &&
    hashMetadataEqual(left, right)
  );
};

const toUpstreamState = (
  upstreamAheadBehind: GitWorktreeStatus["upstreamAheadBehind"],
): {
  upstreamAheadBehind: CommitsAheadBehind | null;
  upstreamStatus: "tracking" | "untracked" | "error";
  error: string | null;
} => {
  if (upstreamAheadBehind.outcome === "tracking") {
    return {
      upstreamAheadBehind: {
        ahead: upstreamAheadBehind.ahead,
        behind: upstreamAheadBehind.behind,
      },
      upstreamStatus: "tracking",
      error: null,
    };
  }

  if (upstreamAheadBehind.outcome === "untracked") {
    return {
      upstreamAheadBehind: {
        ahead: upstreamAheadBehind.ahead,
        behind: 0,
      },
      upstreamStatus: "untracked",
      error: null,
    };
  }

  return {
    upstreamAheadBehind: null,
    upstreamStatus: "error",
    error: `Upstream status unavailable: ${upstreamAheadBehind.message}`,
  };
};

export const toScopeSnapshot = (snapshot: GitWorktreeStatus): ScopeSnapshot => {
  const { upstreamAheadBehind, upstreamStatus, error } = toUpstreamState(
    snapshot.upstreamAheadBehind,
  );
  return {
    branch: snapshot.currentBranch.name ?? null,
    fileDiffs: snapshot.fileDiffs,
    fileStatuses: snapshot.fileStatuses,
    uncommittedFileCount: snapshot.fileStatuses.length,
    commitsAheadBehind: snapshot.targetAheadBehind,
    upstreamAheadBehind,
    upstreamStatus,
    error,
    hashVersion: snapshot.snapshot.hashVersion,
    statusHash: snapshot.snapshot.statusHash,
    diffHash: snapshot.snapshot.diffHash,
  };
};

export const toScopeSummaryFields = (summary: GitWorktreeStatusSummary): ScopeSummaryFields => {
  const { upstreamAheadBehind, upstreamStatus, error } = toUpstreamState(
    summary.upstreamAheadBehind,
  );
  return {
    branch: summary.currentBranch.name ?? null,
    uncommittedFileCount: summary.fileStatusCounts.total,
    commitsAheadBehind: summary.targetAheadBehind,
    upstreamAheadBehind,
    upstreamStatus,
    error,
    hashVersion: summary.snapshot.hashVersion,
    statusHash: summary.snapshot.statusHash,
    diffHash: summary.snapshot.diffHash,
  };
};

const mergeSharedSnapshotFields = (base: ScopeSnapshot, source: ScopeSnapshot): ScopeSnapshot => ({
  ...base,
  branch: source.branch,
  fileStatuses: source.fileStatuses,
  uncommittedFileCount: source.uncommittedFileCount,
  commitsAheadBehind: source.commitsAheadBehind,
  upstreamAheadBehind: source.upstreamAheadBehind,
  upstreamStatus: source.upstreamStatus,
  error: source.error,
  hashVersion: source.hashVersion,
  statusHash: source.statusHash,
});

const mergeSharedSummaryFields = (
  base: ScopeSnapshot,
  source: ScopeSummaryFields,
): ScopeSnapshot => ({
  ...base,
  branch: source.branch,
  uncommittedFileCount: source.uncommittedFileCount,
  commitsAheadBehind: source.commitsAheadBehind,
  upstreamAheadBehind: source.upstreamAheadBehind,
  upstreamStatus: source.upstreamStatus,
  error: source.error,
  hashVersion: source.hashVersion,
  statusHash: source.statusHash,
});

const finalizeCompletedState = (
  previousState: DiffBatchState,
  nextByScope: Record<DiffScope, ScopeSnapshot>,
  nextLoadedByScope: Record<DiffScope, boolean>,
  didChange: boolean,
): DiffBatchState => {
  if (!didChange && nextLoadedByScope === previousState.loadedByScope && !previousState.isLoading) {
    return previousState;
  }

  return {
    byScope: nextByScope,
    loadedByScope: nextLoadedByScope,
    isLoading: false,
  };
};

export const applySummarySnapshot = ({
  state,
  scope,
  summaryFields,
  requestSequence,
  latestSharedSequence,
}: {
  state: DiffBatchState;
  scope: DiffScope;
  summaryFields: ScopeSummaryFields;
  requestSequence: number;
  latestSharedSequence: number;
}): {
  nextState: DiffBatchState;
  nextLatestSharedSequence: number;
  shouldReloadFullScope: boolean;
} => {
  const { sharedHashesChanged, shouldReloadFullScope } = getSummaryReloadDecision(
    state,
    scope,
    summaryFields,
  );
  const previousSummarySnapshot = state.byScope[scope];

  let didChange = false;
  const nextByScope: Record<DiffScope, ScopeSnapshot> = {
    ...state.byScope,
  };
  const nextFetchedScopeSnapshot: ScopeSnapshot = {
    ...previousSummarySnapshot,
    ...summaryFields,
  };

  if (!scopeSnapshotEqual(previousSummarySnapshot, nextFetchedScopeSnapshot)) {
    nextByScope[scope] = nextFetchedScopeSnapshot;
    didChange = true;
  }

  let nextLoadedByScope = state.loadedByScope;
  let nextLatestSharedSequence = latestSharedSequence;
  if (requestSequence >= latestSharedSequence) {
    nextLatestSharedSequence = requestSequence;

    for (const otherScope of ALL_SCOPES) {
      if (otherScope === scope) {
        continue;
      }

      const previousOtherScopeSnapshot = nextByScope[otherScope];
      const nextOtherScopeSnapshot = mergeSharedSummaryFields(
        previousOtherScopeSnapshot,
        summaryFields,
      );

      if (!scopeSnapshotEqual(previousOtherScopeSnapshot, nextOtherScopeSnapshot)) {
        nextByScope[otherScope] = nextOtherScopeSnapshot;
        didChange = true;
      }

      if (sharedHashesChanged && state.loadedByScope[otherScope]) {
        const invalidatedOtherScopeSnapshot: ScopeSnapshot = {
          ...nextByScope[otherScope],
          fileDiffs: EMPTY_DIFFS,
          diffHash: null,
        };
        if (!scopeSnapshotEqual(nextByScope[otherScope], invalidatedOtherScopeSnapshot)) {
          nextByScope[otherScope] = invalidatedOtherScopeSnapshot;
          didChange = true;
        }

        if (nextLoadedByScope[otherScope]) {
          nextLoadedByScope = {
            ...nextLoadedByScope,
            [otherScope]: false,
          };
          didChange = true;
        }
      }
    }
  }

  return {
    nextState: finalizeCompletedState(state, nextByScope, nextLoadedByScope, didChange),
    nextLatestSharedSequence,
    shouldReloadFullScope,
  };
};

export const getSummaryReloadDecision = (
  state: DiffBatchState,
  scope: DiffScope,
  summaryFields: ScopeSummaryFields,
): SummaryReloadDecision => {
  const previousSummarySnapshot = state.byScope[scope];
  const sharedHashesChanged =
    previousSummarySnapshot.hashVersion !== summaryFields.hashVersion ||
    previousSummarySnapshot.statusHash !== summaryFields.statusHash;
  const scopeHashesChanged =
    sharedHashesChanged || previousSummarySnapshot.diffHash !== summaryFields.diffHash;

  return {
    sharedHashesChanged,
    scopeHashesChanged,
    shouldReloadFullScope: state.loadedByScope[scope] && scopeHashesChanged,
  };
};

export const applyFullSnapshot = ({
  state,
  scope,
  snapshot,
  requestSequence,
  latestSharedSequence,
}: {
  state: DiffBatchState;
  scope: DiffScope;
  snapshot: ScopeSnapshot;
  requestSequence: number;
  latestSharedSequence: number;
}): {
  nextState: DiffBatchState;
  nextLatestSharedSequence: number;
} => {
  let didChange = false;
  const nextByScope: Record<DiffScope, ScopeSnapshot> = {
    ...state.byScope,
  };
  const previousFetchedScopeSnapshot = state.byScope[scope];

  if (!scopeSnapshotEqual(previousFetchedScopeSnapshot, snapshot)) {
    nextByScope[scope] = snapshot;
    didChange = true;
  }

  let nextLoadedByScope = state.loadedByScope;
  if (!state.loadedByScope[scope]) {
    nextLoadedByScope = {
      ...state.loadedByScope,
      [scope]: true,
    };
    didChange = true;
  }

  let nextLatestSharedSequence = latestSharedSequence;
  if (requestSequence >= latestSharedSequence) {
    nextLatestSharedSequence = requestSequence;

    for (const otherScope of ALL_SCOPES) {
      if (otherScope === scope) {
        continue;
      }

      const previousOtherScopeSnapshot = nextByScope[otherScope];
      const nextOtherScopeSnapshot = mergeSharedSnapshotFields(
        previousOtherScopeSnapshot,
        snapshot,
      );

      if (!scopeSnapshotEqual(previousOtherScopeSnapshot, nextOtherScopeSnapshot)) {
        nextByScope[otherScope] = nextOtherScopeSnapshot;
        didChange = true;
      }
    }
  }

  return {
    nextState: finalizeCompletedState(state, nextByScope, nextLoadedByScope, didChange),
    nextLatestSharedSequence,
  };
};

export const applyScopeError = ({
  state,
  scope,
  mode,
  error,
}: {
  state: DiffBatchState;
  scope: DiffScope;
  mode: LoadDataMode;
  error: string;
}): DiffBatchState => {
  const previousScopeSnapshot = state.byScope[scope];
  const nextScopeSnapshot: ScopeSnapshot = {
    ...previousScopeSnapshot,
    error,
    hashVersion: null,
    statusHash: null,
    diffHash: null,
  };

  let nextLoadedByScope = state.loadedByScope;
  if (mode === "full" && !state.loadedByScope[scope]) {
    nextLoadedByScope = {
      ...state.loadedByScope,
      [scope]: true,
    };
  }

  const snapshotsEqual = scopeSnapshotEqual(previousScopeSnapshot, nextScopeSnapshot);
  if (snapshotsEqual && nextLoadedByScope === state.loadedByScope && !state.isLoading) {
    return state;
  }

  return {
    byScope: {
      ...state.byScope,
      [scope]: nextScopeSnapshot,
    },
    loadedByScope: nextLoadedByScope,
    isLoading: false,
  };
};

export const toStatusSnapshotKey = (snapshot: ScopeSnapshot): string | null => {
  if (snapshot.fileStatuses.length === 0) {
    return "<empty>";
  }

  return snapshot.fileStatuses
    .map((fileStatus) => `${fileStatus.path}:${fileStatus.status}:${fileStatus.staged ? 1 : 0}`)
    .join("|");
};
