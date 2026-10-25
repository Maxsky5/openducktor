import type { GitCurrentBranch, GitTargetBranch } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { InlineCommentOwner } from "../../drafts/inline-comment-owner";
import { canonicalTargetBranch } from "../../lib/target-branch";
import type { AppVisibility } from "../../platform/app-visibility";
import { checkoutReadIdentity } from "../../queries/git";
import { type GitPanelReads, useGitPanelReads } from "../reads/use-git-panel-reads";
import { withFileQueries } from "../refresh/git-file-refresh";
import type { GitRefreshComparison } from "../refresh/git-refresh-coordinator";
import { useGitRefresh } from "../refresh/use-git-refresh";
import { useComparisonView } from "../session-comparison-view";
import { useGitCommentDraftValidation } from "../use-git-comment-draft-validation";
import { useSessionComparison } from "../use-session-comparison";

/** The session directory, branch, and target that `useWorkspaceSessionGit` returns. */
export type WorkspaceSessionGitSource = {
  workingDirectory: string | null;
  branch: {
    branchKey: string;
    currentBranch: GitCurrentBranch | null;
    branchReady: boolean;
    readBranch: () => Promise<string>;
  };
  branchError: string | null;
  target: GitTargetBranch | null;
  /**
   * The saved target of this session, or null when it follows the repository default. Each saved
   * target has its own Refresh, so loading the default settings keeps the running Refresh.
   */
  savedTarget: GitTargetBranch | null;
  targetError: string | null;
  retryTarget: () => Promise<void>;
};

export type WorkspaceSessionGitPanelInput = {
  /** True while a Git view shows. Reads and refreshes run only then. */
  isVisible: boolean;
  repoPath: string;
  workspaceId: string;
  sessionId: string;
  /** The result of `useWorkspaceSessionGit` for the session. */
  git: WorkspaceSessionGitSource;
  /** Reports each return to the app, so a scheduled refresh runs. */
  visibility: AppVisibility;
};

/**
 * The Git data of a workspace session (a chat): the comparison with its target, the local and
 * branch changes, the check of its restored inline comments, and the refresh of its directory.
 */
export function useWorkspaceSessionGitPanel({
  isVisible,
  repoPath,
  workspaceId,
  sessionId,
  git,
  visibility,
}: WorkspaceSessionGitPanelInput) {
  const { workingDirectory, branchError, target, savedTarget, targetError, retryTarget } = git;
  const { branchKey, currentBranch, branchReady, readBranch } = git.branch;
  const sessionKey = JSON.stringify([workspaceId, sessionId]);
  const commentOwner = useMemo<Extract<InlineCommentOwner, { kind: "workspace_session" }>>(
    () => ({ kind: "workspace_session", workspaceId, sessionId }),
    [workspaceId, sessionId],
  );
  const checkoutIdentity = checkoutReadIdentity(currentBranch);
  const comparison = useSessionComparison({
    enabled: isVisible,
    viewKey: sessionKey,
    repoPath,
    workingDirectory,
    target,
    targetError,
    branchKey,
    checkoutIdentity,
    branchReady,
    branchError,
  });
  const readsRepoPath = workingDirectory ? repoPath : null;
  const reads = useGitPanelReads({
    repoPath: readsRepoPath,
    workingDir: workingDirectory,
    comparisonReference: comparison.resolvedTarget,
    cacheKey: comparison.cacheKey,
    checkoutIdentity,
    enabled: isVisible && workingDirectory !== null && branchReady,
  });
  const diffData = useComparisonView(reads, comparison, {
    repoPath: readsRepoPath,
    worktreePath: workingDirectory,
    label: target ? canonicalTargetBranch(target) : "Default target pending",
    checkout: currentBranch,
  });
  const unavailableReason = diffData.comparisonUnavailableReason ?? null;
  // An in-flight diff can finish after the tools view closes.
  useGitCommentDraftValidation({
    commentOwner,
    targetBranch: comparison.resolvedTarget,
    comparisonUnavailableReason: unavailableReason,
    scopeStatesByScope: diffData.scopeStatesByScope,
    loadedScopesByScope: diffData.loadedScopesByScope,
  });
  const gitRefresh = useWorkspaceGitRefresh({
    sessionKey,
    repoPath,
    workingDirectory,
    savedTarget,
    branchKey,
    visible: isVisible,
    ready: branchReady,
    prepare: targetError ? retryTarget : null,
    readBranch,
    comparison: comparison.refreshStep,
    reads,
    visibility,
  });
  return {
    sessionKey,
    commentOwner,
    comparison,
    /** The repository that the reads use, or null while the directory is unavailable. */
    readsRepoPath,
    diffData,
    unavailableReason,
    /** The checked comparison reference. Branch changes and file markers use it. */
    resolvedTarget: diffData.comparisonReference ?? null,
    applyLocalChanges: reads.applyLocalChanges,
    refresh: gitRefresh.refresh,
    manualRefresh: gitRefresh.manual,
    /** A soft refresh of Git and files, for a tool change. */
    refreshTools: gitRefresh.refreshTools,
  };
}

/**
 * Connects the session panel to its refresh coordinator. A Refresh, its pending state, and its
 * failure belong to the session, directory, saved target, and checkout.
 */
function useWorkspaceGitRefresh({
  sessionKey,
  repoPath,
  workingDirectory,
  savedTarget,
  branchKey,
  visible,
  ready,
  prepare,
  readBranch,
  comparison,
  reads,
  visibility,
}: {
  sessionKey: string;
  repoPath: string;
  workingDirectory: string | null;
  savedTarget: GitTargetBranch | null;
  branchKey: string;
  visible: boolean;
  ready: boolean;
  prepare: (() => Promise<void>) | null;
  readBranch: () => Promise<string>;
  comparison: GitRefreshComparison | null;
  reads: GitPanelReads;
  visibility: AppVisibility;
}) {
  const queryClient = useQueryClient();
  const scopeKey = JSON.stringify([sessionKey, repoPath, workingDirectory, savedTarget ?? null]);
  const withFiles = useMemo(
    () =>
      withFileQueries(
        queryClient,
        workingDirectory ? [workingDirectory] : [],
        JSON.stringify([scopeKey, branchKey]),
      ),
    [branchKey, queryClient, scopeKey, workingDirectory],
  );
  const shown = visible && workingDirectory !== null;
  const gitRefresh = useGitRefresh({
    view: {
      scopeKey,
      branchKey,
      visible: shown,
      ready,
      prepare,
      steps: {
        readBranch,
        comparison,
        readLocal: reads.readLocal,
        readComparison: reads.readComparison,
        readInBackground: reads.readInBackground,
        markStale: reads.markStale,
      },
      withFiles,
    },
    refreshOnFocus: shown,
    visibility,
  });
  const { refresh } = gitRefresh;
  const refreshTools = useCallback(() => refresh("soft"), [refresh]);
  return { ...gitRefresh, refreshTools };
}
