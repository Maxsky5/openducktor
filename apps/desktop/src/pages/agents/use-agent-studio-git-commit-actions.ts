import { useCallback, useState } from "react";
import { host } from "@/state/operations/shared/host";
import {
  type GitActionKind,
  type RefreshGitDiffData,
  toErrorMessage,
} from "./use-agent-studio-git-action-utils";

type UseAgentStudioGitCommitActionsArgs = {
  repoPath: string | null;
  workingDir: string | null;
  refreshDiffData: RefreshGitDiffData;
  clearActionErrors: () => void;
  ensureGitActionsUnlocked: (kind: GitActionKind) => boolean;
  setCommitError: (message: string | null) => void;
};

export function useAgentStudioGitCommitActions({
  repoPath,
  workingDir,
  refreshDiffData,
  clearActionErrors,
  ensureGitActionsUnlocked,
  setCommitError,
}: UseAgentStudioGitCommitActionsArgs) {
  const [isCommitting, setIsCommitting] = useState(false);

  const commitAll = useCallback(
    async (message: string): Promise<boolean> => {
      if (isCommitting) {
        return false;
      }
      if (!ensureGitActionsUnlocked("commit")) {
        return false;
      }

      if (!repoPath) {
        setCommitError("Cannot commit because no repository is selected.");
        return false;
      }

      const trimmedMessage = message.trim();
      if (trimmedMessage.length === 0) {
        setCommitError("Commit message cannot be empty.");
        return false;
      }

      setIsCommitting(true);
      setCommitError(null);
      try {
        try {
          await host.gitCommitAll(repoPath, trimmedMessage, workingDir ?? undefined);
          clearActionErrors();
        } catch (error) {
          setCommitError(toErrorMessage(error, "Commit failed."));
          return false;
        }

        try {
          await refreshDiffData();
        } catch (error) {
          setCommitError(toErrorMessage(error, "Diff refresh failed."));
        }

        return true;
      } finally {
        setIsCommitting(false);
      }
    },
    [
      clearActionErrors,
      ensureGitActionsUnlocked,
      isCommitting,
      refreshDiffData,
      repoPath,
      setCommitError,
      workingDir,
    ],
  );

  return {
    isCommitting,
    commitAll,
  };
}
