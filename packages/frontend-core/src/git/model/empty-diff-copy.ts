import type { DiffScope } from "../contracts";
import type { TaskGitContextMode } from "../task/task-worktree-paths";

/** The text of a diff list without files. Only an action that the user can take has a description. */
export type EmptyDiffCopy = { title: string; description: string | null };

/**
 * The text of a diff list that reads or has no files. The repository root of a workspace
 * compares with its upstream, so it names the repository and a missing upstream branch.
 */
export const emptyDiffCopy = ({
  targetBranch,
  isLoading,
  contextMode,
  diffScope,
  upstreamStatus,
}: {
  /** The label of the comparison target, or an empty text when it has none. */
  targetBranch: string;
  isLoading: boolean;
  contextMode: TaskGitContextMode;
  diffScope: DiffScope;
  upstreamStatus: "tracking" | "untracked" | "error" | undefined;
}): EmptyDiffCopy => {
  const repositoryTarget = contextMode === "repository" && diffScope === "target";
  if (diffScope === "target" && targetBranch) {
    return {
      title: isLoading
        ? `Checking changes against ${targetBranch}...`
        : `No changes against ${targetBranch}`,
      description: null,
    };
  }
  if (isLoading) {
    return {
      title: repositoryTarget ? "Checking branch changes..." : "Scanning for changes...",
      description: null,
    };
  }
  if (repositoryTarget && upstreamStatus === "untracked") {
    return {
      title: "No upstream branch yet",
      description: "Push the branch first to create its upstream.",
    };
  }
  if (repositoryTarget) return { title: "No branch changes detected", description: null };
  if (contextMode === "repository") {
    return { title: "No repository changes detected", description: null };
  }
  return { title: "No changes detected", description: null };
};
