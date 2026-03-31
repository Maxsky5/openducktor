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
    async (options?: { forceWithLease?: boolean }): Promise<void> => {
      if (isPushing) {
        return;
      }
      if (!ensureGitActionsUnlocked("push")) {
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

      const forceWithLease = options?.forceWithLease ?? false;
      setIsPushing(true);
      setPushError(null);
      try {
        const pushResult = await host.gitPushBranch(repoPath, branch, {
          setUpstream: true,
          forceWithLease,
          ...(workingDir != null ? { workingDir } : {}),
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
          });
          return;
        }

        clearActionErrors();
        setPendingForcePush(null);
        toast.success(`Pushed ${pushResult.branch}`, {
          description: `Remote: ${pushResult.remote}`,
        });
        await refreshDiffData();
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

    setPendingForcePush(null);
    await pushBranchInternal({ forceWithLease: true });
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
