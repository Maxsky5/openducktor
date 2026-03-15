import { FolderGit2 } from "lucide-react";
import type { ReactElement } from "react";
import type { DiffScope } from "@/features/agent-studio-git";

export function EmptyDiffState({
  isLoading,
  contextMode = "worktree",
  diffScope,
  upstreamStatus,
}: {
  isLoading: boolean;
  contextMode?: "repository" | "worktree";
  diffScope: DiffScope;
  upstreamStatus?: "tracking" | "untracked" | "error";
}): ReactElement {
  const title = (() => {
    if (isLoading) {
      return contextMode === "repository" && diffScope === "target"
        ? "Checking upstream differences..."
        : "Scanning for changes...";
    }
    if (contextMode === "repository" && diffScope === "target" && upstreamStatus === "untracked") {
      return "No upstream branch yet";
    }
    if (contextMode === "repository" && diffScope === "target") {
      return "No upstream differences detected";
    }
    if (contextMode === "repository") {
      return "No repository changes detected";
    }
    return "No changes detected";
  })();

  const description = (() => {
    if (isLoading) {
      return contextMode === "repository" && diffScope === "target"
        ? "Comparing this branch against its tracked upstream branch."
        : "Checking the working directory for file modifications.";
    }
    if (contextMode === "repository" && diffScope === "target" && upstreamStatus === "untracked") {
      return "This branch is not tracking an upstream branch yet. Push it first to create one, then compare against it here.";
    }
    if (contextMode === "repository" && diffScope === "target") {
      return "Differences against the tracked upstream branch will appear here.";
    }
    if (contextMode === "repository") {
      return "Uncommitted changes in the repository branch will appear here.";
    }
    return "File modifications will appear here once the agent starts editing.";
  })();

  return (
    <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted/60">
        <FolderGit2 className="size-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <p className="text-xs text-muted-foreground/70">{description}</p>
      </div>
    </div>
  );
}
