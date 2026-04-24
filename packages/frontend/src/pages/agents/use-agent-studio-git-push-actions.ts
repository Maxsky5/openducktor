import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { AgentStudioPendingForcePush } from "@/features/agent-studio-git";
import { host } from "@/state/operations/shared/host";
import {
  type GitActionKind,
  type RefreshGitDiffData,
  toErrorMessage,
} from "./use-agent-studio-git-action-utils";

type UseAgentStudioGitPushActionsArgs = {
  repoPath: string | null;
  workingDir: string | null;
  branch: string | null;
  refreshDiffData: RefreshGitDiffData;
  clearActionErrors: () => void;
  ensureGitActionsUnlocked: (kind: GitActionKind) => boolean;
  setPushError: (message: string | null) => void;
};

type GitPushTarget = {
  repoPath: string;
  branch: string;
  workingDir: string | null;
};

export function useAgentStudioGitPushActions({
  repoPath,
  workingDir,
  branch,
  refreshDiffData,
  clearActionErrors,
  ensureGitActionsUnlocked,
  setPushError,
}: UseAgentStudioGitPushActionsArgs) {
  const [isPushing, setIsPushing] = useState(false);
  const [pendingForcePush, setPendingForcePush] = useState<AgentStudioPendingForcePush | null>(
    null,
  );

  const pushBranchInternal = useCallback(
    async (options?: { forceWithLease?: boolean; target?: GitPushTarget }): Promise<void> => {
      if (isPushing) {
        return;
      }
      if (!ensureGitActionsUnlocked("push")) {
        return;
      }

      const resolvedRepoPath = options?.target?.repoPath ?? repoPath;
      const resolvedBranch = options?.target?.branch ?? branch;
      const resolvedWorkingDir = options?.target?.workingDir ?? workingDir;

      if (!resolvedRepoPath) {
        setPushError("Cannot push because no repository is selected.");
        return;
      }

      if (!resolvedBranch) {
        setPushError("Cannot push because current branch is unavailable.");
        return;
      }

      const forceWithLease = options?.forceWithLease ?? false;
      setIsPushing(true);
      setPushError(null);
      try {
        const pushResult = await host.gitPushBranch(resolvedRepoPath, resolvedBranch, {
          setUpstream: true,
          forceWithLease,
          ...(resolvedWorkingDir != null ? { workingDir: resolvedWorkingDir } : {}),
        });

        if (pushResult.outcome === "rejected_non_fast_forward") {
          if (forceWithLease) {
            const message = pushResult.output.trim() || "Force push was rejected.";
            setPushError(message);
            toast.error("Force push rejected", { description: message });
            return;
          }

          setPendingForcePush({
            remote: pushResult.remote,
            branch: pushResult.branch,
            output: pushResult.output,
            repoPath: resolvedRepoPath,
            workingDir: resolvedWorkingDir,
          });
          return;
        }

        clearActionErrors();
        setPendingForcePush(null);
        toast.success(`Pushed ${pushResult.branch}`, {
          description: `Remote: ${pushResult.remote}`,
        });
        await refreshDiffData("soft");
      } catch (error) {
        const message = toErrorMessage(
          error,
          forceWithLease ? "Force push failed." : "Push failed.",
        );
        setPushError(message);
        toast.error(forceWithLease ? "Force push failed" : "Push failed", {
          description: message,
        });
      } finally {
        setIsPushing(false);
      }
    },
    [
      branch,
      clearActionErrors,
      ensureGitActionsUnlocked,
      isPushing,
      refreshDiffData,
      repoPath,
      setPushError,
      workingDir,
    ],
  );

  const pushBranch = useCallback(async (): Promise<void> => {
    await pushBranchInternal();
  }, [pushBranchInternal]);

  const confirmForcePush = useCallback(async (): Promise<void> => {
    if (!pendingForcePush) {
      return;
    }

    const confirmedTarget = {
      repoPath: pendingForcePush.repoPath,
      branch: pendingForcePush.branch,
      workingDir: pendingForcePush.workingDir,
    } satisfies GitPushTarget;

    setPendingForcePush(null);
    await pushBranchInternal({ forceWithLease: true, target: confirmedTarget });
  }, [pendingForcePush, pushBranchInternal]);

  const cancelForcePush = useCallback((): void => {
    setPendingForcePush(null);
    setPushError(null);
  }, [setPushError]);

  return {
    isPushing,
    pendingForcePush,
    pushBranch,
    confirmForcePush,
    cancelForcePush,
  };
}
