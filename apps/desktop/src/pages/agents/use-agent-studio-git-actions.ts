import { useCallback, useState } from "react";
import { toast } from "sonner";
import { normalizeCanonicalTargetBranch } from "@/lib/target-branch";
import { host } from "@/state/operations/host";

export type AgentStudioGitActionState = {
  isCommitting: boolean;
  isPushing: boolean;
  isRebasing: boolean;
  commitError: string | null;
  pushError: string | null;
  rebaseError: string | null;
  commitAll: (message: string) => Promise<void>;
  pushBranch: () => Promise<void>;
  rebaseOntoTarget: () => Promise<void>;
  pullFromUpstream: () => Promise<void>;
};

type UseAgentStudioGitActionsInput = {
  repoPath: string | null;
  workingDir: string | null;
  branch: string | null;
  targetBranch: string;
  refreshDiffData: () => void | Promise<void>;
};

const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return fallback;
};

export function useAgentStudioGitActions({
  repoPath,
  workingDir,
  branch,
  targetBranch,
  refreshDiffData,
}: UseAgentStudioGitActionsInput): AgentStudioGitActionState {
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isRebasing, setIsRebasing] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [rebaseError, setRebaseError] = useState<string | null>(null);

  const clearActionErrors = useCallback(() => {
    setCommitError(null);
    setPushError(null);
    setRebaseError(null);
  }, []);

  const commitAll = useCallback(
    async (message: string): Promise<void> => {
      if (isCommitting) {
        return;
      }

      if (!repoPath) {
        setCommitError("Cannot commit because no repository is selected.");
        return;
      }

      const trimmedMessage = message.trim();
      if (trimmedMessage.length === 0) {
        setCommitError("Commit message cannot be empty.");
        return;
      }

      setIsCommitting(true);
      setCommitError(null);
      try {
        await host.gitCommitAll(repoPath, trimmedMessage, workingDir ?? undefined);
        clearActionErrors();
        await refreshDiffData();
      } catch (error) {
        setCommitError(toErrorMessage(error, "Commit failed."));
      } finally {
        setIsCommitting(false);
      }
    },
    [clearActionErrors, isCommitting, refreshDiffData, repoPath, workingDir],
  );

  const pushBranch = useCallback(async (): Promise<void> => {
    if (isPushing) {
      return;
    }

    if (!repoPath) {
      setPushError("Cannot push because no repository is selected.");
      return;
    }

    if (!branch) {
      setPushError("Cannot push because current branch is unavailable.");
      return;
    }

    setIsPushing(true);
    setPushError(null);
    try {
      const pushSummary = await host.gitPushBranch(repoPath, branch, {
        setUpstream: true,
        ...(workingDir != null ? { workingDir } : {}),
      });
      clearActionErrors();
      toast.success(`Pushed ${pushSummary.branch}`, {
        description: `Remote: ${pushSummary.remote}`,
      });
      await refreshDiffData();
    } catch (error) {
      const message = toErrorMessage(error, "Push failed.");
      setPushError(message);
      toast.error("Push failed", { description: message });
    } finally {
      setIsPushing(false);
    }
  }, [branch, clearActionErrors, isPushing, refreshDiffData, repoPath, workingDir]);

  const runRebase = useCallback(
    async (target: string, missingTargetError: string, fallbackError: string): Promise<void> => {
      if (isRebasing) {
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
        await host.gitRebaseBranch(repoPath, trimmedTarget, workingDir ?? undefined);
        clearActionErrors();
        await refreshDiffData();
      } catch (error) {
        setRebaseError(toErrorMessage(error, fallbackError));
      } finally {
        setIsRebasing(false);
      }
    },
    [clearActionErrors, isRebasing, refreshDiffData, repoPath, workingDir],
  );

  const rebaseOntoTarget = useCallback(async (): Promise<void> => {
    await runRebase(
      normalizeCanonicalTargetBranch(targetBranch),
      "Cannot rebase because target branch is not configured.",
      "Rebase failed.",
    );
  }, [runRebase, targetBranch]);

  const pullFromUpstream = useCallback(async (): Promise<void> => {
    if (isRebasing) {
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

    setIsRebasing(true);
    setRebaseError(null);
    try {
      const result = await host.gitPullBranch(repoPath, workingDir ?? undefined);

      if (result.outcome === "conflicts") {
        const message =
          result.conflictedFiles.length > 0
            ? `Pull stopped due to conflicts in: ${result.conflictedFiles.join(", ")}.`
            : "Pull stopped due to conflicts.";
        setRebaseError(message);
        toast.error("Pull requires conflict resolution", { description: message });
        await refreshDiffData();
        return;
      }

      clearActionErrors();
      toast.success(
        result.outcome === "up_to_date" ? "Already up to date" : "Pulled from upstream",
      );
      await refreshDiffData();
    } catch (error) {
      const message = toErrorMessage(error, "Pull failed.");
      setRebaseError(message);
      toast.error("Pull failed", { description: message });
    } finally {
      setIsRebasing(false);
    }
  }, [branch, clearActionErrors, isRebasing, refreshDiffData, repoPath, workingDir]);

  return {
    isCommitting,
    isPushing,
    isRebasing,
    commitError,
    pushError,
    rebaseError,
    commitAll,
    pushBranch,
    rebaseOntoTarget,
    pullFromUpstream,
  };
}
