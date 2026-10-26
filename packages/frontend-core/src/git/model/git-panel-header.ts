import type { DiffDataState, DiffScopeState } from "../contracts";

/** The file count of each list tab of the Git panel, or null when its tab shows no count. */
export type GitPanelTabCounts = {
  uncommitted: number | null;
  target: number | null;
};

/**
 * The file counts of the list tabs. A tab shows a count only after its read loaded files. The
 * counts stay numbers, so a memoized header compares them by value.
 */
export const gitPanelTabCounts = (diffData: DiffDataState): GitPanelTabCounts => {
  const local = diffData.scopeStatesByScope.uncommitted;
  const target = diffData.scopeStatesByScope.target;
  return {
    uncommitted:
      diffData.loadedScopesByScope.uncommitted && local.uncommittedFileCount > 0
        ? local.uncommittedFileCount
        : null,
    target:
      diffData.comparisonReference &&
      diffData.loadedScopesByScope.target &&
      target.fileDiffs.length > 0
        ? target.fileDiffs.length
        : null,
  };
};

export type GitHeaderNoticeKey =
  | "detect-pr"
  | "lock"
  | "refresh"
  | "upstream"
  | "comparison"
  | "rebase"
  | "push";

/** A notice under the branch row of the Git panel header. */
export type GitHeaderNotice = {
  key: GitHeaderNoticeKey;
  tone: "warning" | "error" | "muted";
  text: string;
};

type GitHeaderNoticeInput = {
  /** Why Detect PR cannot run, when the header shows Detect PR. */
  detectPullRequestError: string | null;
  /** Why the Git actions are locked, when the header shows the lock. */
  lockReason: string | null;
  refreshError: string | null;
  upstreamStatus: DiffScopeState["upstreamStatus"];
  upstreamError: string | null;
  comparisonPending: boolean;
  comparisonUnavailableReason: string | null;
  rebaseError: string | null;
  pushError: string | null;
};

/** The notices under the branch row, in display order. */
export const gitHeaderNotices = (input: GitHeaderNoticeInput): GitHeaderNotice[] => {
  const notices: GitHeaderNotice[] = [];
  if (input.detectPullRequestError) {
    notices.push({ key: "detect-pr", tone: "error", text: input.detectPullRequestError });
  }
  if (input.lockReason) {
    notices.push({ key: "lock", tone: "warning", text: input.lockReason });
  }
  if (input.refreshError) {
    notices.push({ key: "refresh", tone: "error", text: `Refresh failed: ${input.refreshError}` });
  }
  if (input.upstreamStatus === "error") {
    const detail = input.upstreamError ? ` ${input.upstreamError}` : "";
    notices.push({
      key: "upstream",
      tone: "error",
      text: `Upstream status is unavailable.${detail}`,
    });
  }
  // A pending comparison read can still find the comparison branch.
  if (!input.comparisonPending && input.comparisonUnavailableReason) {
    notices.push({ key: "comparison", tone: "muted", text: input.comparisonUnavailableReason });
  }
  if (input.rebaseError) {
    notices.push({ key: "rebase", tone: "error", text: input.rebaseError });
  }
  if (input.pushError) {
    notices.push({ key: "push", tone: "error", text: input.pushError });
  }
  return notices;
};
