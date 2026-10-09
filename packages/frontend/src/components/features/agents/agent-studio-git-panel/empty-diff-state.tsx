import { FolderGit2 } from "lucide-react";
import type { ReactElement } from "react";
import type { DiffScope } from "@/features/agent-studio-git";

export function EmptyDiffState({
  targetBranch,
  isLoading,
  contextMode = "worktree",
  diffScope,
  upstreamStatus,
}: {
  targetBranch?: string;
  isLoading: boolean;
  contextMode?: "repository" | "worktree";
  diffScope: DiffScope;
  upstreamStatus?: "tracking" | "untracked" | "error";
}): ReactElement {
  const title = (() => {
    if (diffScope === "target" && targetBranch)
      return isLoading
        ? `Checking changes against ${targetBranch}...`
        : `No changes against ${targetBranch}`;
    if (isLoading) {
      return contextMode === "repository" && diffScope === "target"
        ? "Checking branch changes..."
        : "Scanning for changes...";
    }
    if (contextMode === "repository" && diffScope === "target" && upstreamStatus === "untracked") {
      return "No upstream branch yet";
    }
    if (contextMode === "repository" && diffScope === "target") {
      return "No branch changes detected";
    }
    if (contextMode === "repository") {
      return "No repository changes detected";
    }
    return "No changes detected";
  })();

  const description = (() => {
    if (diffScope === "target" && targetBranch)
      return `Changes since this branch diverged from ${targetBranch} appear here.`;
    if (isLoading) {
      return contextMode === "repository" && diffScope === "target"
        ? "Collecting changes in this branch since it diverged from its tracked upstream branch."
        : "Checking the working directory for file modifications.";
    }
    if (contextMode === "repository" && diffScope === "target" && upstreamStatus === "untracked") {
      return "This branch is not tracking an upstream branch yet. Push it first to create one, then its branch changes will appear here.";
    }
    if (contextMode === "repository" && diffScope === "target") {
      return "Changes in this branch since it diverged from the tracked upstream branch will appear here.";
    }
    if (contextMode === "repository") {
      return "Uncommitted changes in the repository branch will appear here.";
    }
    return "Uncommitted changes in this worktree will appear here.";
  })();

  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-5 text-center">
      <div className="space-y-1">
        <p className="flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground">
          <FolderGit2 className="size-4 shrink-0" />
          {title}
        </p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
