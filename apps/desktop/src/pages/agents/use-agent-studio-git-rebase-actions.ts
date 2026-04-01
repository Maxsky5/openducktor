import type { CommitsAheadBehind } from "@openducktor/contracts";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { AgentStudioPendingPullRebase, GitConflict } from "@/features/agent-studio-git";
import { host } from "@/state/operations/shared/host";
import {
  type GitActionKind,
  type RefreshGitDiffData,
  toConflictMessage,
  toErrorMessage,
} from "./use-agent-studio-git-action-utils";

type UseAgentStudioGitRebaseActionsArgs = {
  repoPath: string | null;
  workingDir: string | null;
  branch: string | null;
  targetBranch: string;
  upstreamAheadBehind: CommitsAheadBehind | null;
  refreshDiffData: RefreshGitDiffData;
  clearActionErrors: () => void;
  ensureGitActionsUnlocked: (kind: GitActionKind) => boolean;
  setRebaseError: (message: string | null) => void;
  captureFreshConflict: (conflict: GitConflict) => void;
};

export function useAgentStudioGitRebaseActions({
  repoPath,
  workingDir,
  branch,
  targetBranch,
  upstreamAheadBehind,
  refreshDiffData,
  clearActionErrors,
  ensureGitActionsUnlocked,
  setRebaseError,
  captureFreshConflict,
}: UseAgentStudioGitRebaseActionsArgs) {
  const [isRebasing, setIsRebasing] = useState(false);
  const [pendingPullRebase, setPendingPullRebase] = useState<AgentStudioPendingPullRebase | null>(
    null,
  );

  const pullFromUpstreamInternal = useCallback(
    async (options?: {
      skipRebaseConfirmation?: boolean;
      localAhead?: number;
      upstreamBehind?: number;
    }): Promise<void> => {
      if (isRebasing) {
        return;
      }
      if (!ensureGitActionsUnlocked("rebase")) {
        return;
      }

      if (!repoPath) {
        setRebaseError("Cannot pull because no repository is selected.");
        return;
      }

      if (!branch || branch.trim().length === 0) {
        setRebaseError("Cannot pull because current branch is unavailable.");
        return;
      }

      const localAhead = options?.localAhead ?? upstreamAheadBehind?.ahead ?? 0;
      const upstreamBehindCount = options?.upstreamBehind ?? upstreamAheadBehind?.behind ?? 0;
      const willRebaseLocalCommits = localAhead > 0 && upstreamBehindCount > 0;
      const isConfirmedPullRebase =
        options?.skipRebaseConfirmation === true && willRebaseLocalCommits;

      if (willRebaseLocalCommits && !options?.skipRebaseConfirmation) {
        setPendingPullRebase({
          branch,
          localAhead,
          upstreamBehind: upstreamBehindCount,
        });
        return;
      }

      setIsRebasing(true);
      setRebaseError(null);
      try {
        const result = await host.gitPullBranch(repoPath, workingDir ?? undefined);

        if (result.outcome === "conflicts") {
          if (isConfirmedPullRebase) {
            setPendingPullRebase(null);
          }
          const conflict: GitConflict = {
            operation: "pull_rebase",
            currentBranch: branch,
            targetBranch: "tracked upstream branch",
            conflictedFiles: result.conflictedFiles,
            output: result.output,
            workingDir,
          };
          const message = toConflictMessage(result.conflictedFiles, "pull_rebase");
          captureFreshConflict(conflict);
          toast.error("Pull requires conflict resolution", { description: message });
          await refreshDiffData();
          return;
        }

        clearActionErrors();
        if (isConfirmedPullRebase) {
          setPendingPullRebase(null);
        }
        if (result.outcome === "up_to_date") {
          toast.success("Already up to date");
        } else if (willRebaseLocalCommits) {
          toast.success("Rebased local commits onto upstream", {
            description: `Reapplied ${localAhead} local commit${localAhead === 1 ? "" : "s"}.`,
          });
        } else {
          toast.success("Pulled from upstream");
        }
        await refreshDiffData();
      } catch (error) {
        const message = toErrorMessage(error, "Pull failed.");
        setRebaseError(message);
        setPendingPullRebase(null);
        toast.error("Pull failed", { description: message });
      } finally {
        setIsRebasing(false);
      }
    },
    [
      branch,
      captureFreshConflict,
      clearActionErrors,
      ensureGitActionsUnlocked,
      isRebasing,
      refreshDiffData,
      repoPath,
      setRebaseError,
      upstreamAheadBehind?.ahead,
      upstreamAheadBehind?.behind,
      workingDir,
    ],
  );

  const runRebase = useCallback(
    async (target: string, missingTargetError: string, fallbackError: string): Promise<void> => {
      if (isRebasing) {
        return;
      }
      if (!ensureGitActionsUnlocked("rebase")) {
        return;
      }

      if (!repoPath) {
        setRebaseError("Cannot rebase because no repository is selected.");
        return;
      }

      const trimmedTarget = target.trim();
      if (trimmedTarget.length === 0) {
        setRebaseError(missingTargetError);
        return;
      }

      setIsRebasing(true);
      setRebaseError(null);
      try {
        const result = await host.gitRebaseBranch(repoPath, trimmedTarget, workingDir ?? undefined);
        if (result.outcome === "conflicts") {
          const conflict: GitConflict = {
            operation: "rebase",
            currentBranch: branch,
            targetBranch: trimmedTarget,
            conflictedFiles: result.conflictedFiles,
            output: result.output,
            workingDir,
          };
          const message = toConflictMessage(result.conflictedFiles, "rebase");
          captureFreshConflict(conflict);
          toast.error("Rebase requires conflict resolution", { description: message });
          await refreshDiffData();
          return;
        }

        clearActionErrors();
        await refreshDiffData();
      } catch (error) {
        setRebaseError(toErrorMessage(error, fallbackError));
      } finally {
        setIsRebasing(false);
      }
    },
    [
      branch,
      captureFreshConflict,
      clearActionErrors,
      ensureGitActionsUnlocked,
      isRebasing,
      refreshDiffData,
      repoPath,
      setRebaseError,
      workingDir,
    ],
  );

  const pullFromUpstream = useCallback(async (): Promise<void> => {
    await pullFromUpstreamInternal();
  }, [pullFromUpstreamInternal]);

  const confirmPullRebase = useCallback(async (): Promise<void> => {
    if (!pendingPullRebase) {
      return;
    }

    await pullFromUpstreamInternal({
      skipRebaseConfirmation: true,
      localAhead: pendingPullRebase.localAhead,
      upstreamBehind: pendingPullRebase.upstreamBehind,
    });
  }, [pendingPullRebase, pullFromUpstreamInternal]);

  const cancelPullRebase = useCallback((): void => {
    setPendingPullRebase(null);
    setRebaseError(null);
  }, [setRebaseError]);

  const rebaseOntoTarget = useCallback(async (): Promise<void> => {
    await runRebase(
      targetBranch,
      "Cannot rebase because target branch is not configured.",
      "Rebase failed.",
    );
  }, [runRebase, targetBranch]);

  return {
    isRebasing,
    pendingPullRebase,
    pullFromUpstream,
    confirmPullRebase,
    cancelPullRebase,
    rebaseOntoTarget,
  };
}
