import type {
  GitCommitAllResult,
  GitCommitStagedRequest,
  GitLocalChanges,
} from "@openducktor/contracts";
import { useCallback, useState } from "react";
import type { GitCommitMode } from "@openducktor/frontend-core/git/contracts";
import {
  type GitActionKind,
  type RefreshGitDiffData,
  refreshAfterGitAction,
  toErrorMessage,
} from "./use-agent-studio-git-action-utils";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";

type UseAgentStudioGitCommitActionsArgs = {
  isCurrentContext: () => boolean;
  repoPath: string | null;
  workingDir: string | null;
  localChanges: GitLocalChanges | null;
  refreshDiffData: RefreshGitDiffData;
  clearActionErrors: () => void;
  ensureGitActionsUnlocked: (kind: GitActionKind) => boolean;
  setCommitError: (message: string | null) => void;
};

const NO_CHANGES_MESSAGE = {
  staged: "Git found no staged changes to commit. Stage files or chunks first.",
  all: "Git found no changes to commit.",
} satisfies Record<GitCommitMode, string>;

export function useAgentStudioGitCommitActions({
  isCurrentContext,
  repoPath,
  workingDir,
  localChanges,
  refreshDiffData,
  clearActionErrors,
  ensureGitActionsUnlocked,
  setCommitError,
}: UseAgentStudioGitCommitActionsArgs) {
  const host = useHostClient();
  const [committingMode, setCommittingMode] = useState<GitCommitMode | null>(null);

  /** Resolves true only after Git confirms a new commit. */
  const commit = useCallback(
    async (mode: GitCommitMode, message: string): Promise<boolean> => {
      if (committingMode !== null) return false;
      if (!ensureGitActionsUnlocked("commit")) return false;
      if (!repoPath || !localChanges) {
        setCommitError("Cannot commit because the changes are unavailable. Refresh and try again.");
        return false;
      }
      const trimmedMessage = message.trim();
      if (trimmedMessage.length === 0) {
        setCommitError("Commit message cannot be empty.");
        return false;
      }

      const expectedBranch = localChanges.currentBranch;
      setCommittingMode(mode);
      setCommitError(null);
      const stagedRequest: GitCommitStagedRequest = {
        repoPath,
        message: trimmedMessage,
        expectedBranch,
        stagedSnapshot: localChanges.staged.snapshot,
      };
      if (workingDir) stagedRequest.workingDir = workingDir;
      // The composer stays busy until the panel reads the result, so no action uses old data.
      try {
        let result: GitCommitAllResult;
        try {
          result =
            mode === "staged"
              ? await host.gitCommitStaged(stagedRequest)
              : await host.gitCommitAll(
                  repoPath,
                  trimmedMessage,
                  workingDir ?? undefined,
                  expectedBranch,
                );
        } catch (error) {
          if (isCurrentContext()) setCommitError(toErrorMessage(error, "Commit failed."));
          // Commit all can stage content, and a commit hook can change files, before a commit
          // fails. Show the actual state. The refresh path reports its own failure.
          await refreshDiffData("soft").catch(() => undefined);
          return false;
        }
        if (result.outcome === "no_changes") {
          if (isCurrentContext()) setCommitError(NO_CHANGES_MESSAGE[mode]);
          await refreshDiffData("soft").catch(() => undefined);
          return false;
        }
        if (isCurrentContext()) clearActionErrors();
        const updateFailure = await refreshAfterGitAction(
          refreshDiffData,
          `Commit ${result.commitHash.slice(0, 7)} succeeded`,
        );
        if (updateFailure && isCurrentContext()) setCommitError(updateFailure);
        return true;
      } finally {
        setCommittingMode(null);
      }
    },
    [
      host,
      clearActionErrors,
      committingMode,
      ensureGitActionsUnlocked,
      isCurrentContext,
      localChanges,
      refreshDiffData,
      repoPath,
      setCommitError,
      workingDir,
    ],
  );

  return { committingMode, commit };
}
