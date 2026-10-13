import { FolderGit2 } from "lucide-react";
import type { ReactElement } from "react";
import type { DiffScope } from "@/features/agent-studio-git";

export function EmptyDiffState({
  targetBranch,
  isLoading,
  contextMode = "worktree",
  diffScope,
  upstreamStatus,
  failed = false,
}: {
  targetBranch?: string;
  isLoading: boolean;
  contextMode?: "repository" | "worktree";
  diffScope: DiffScope;
  upstreamStatus?: "tracking" | "untracked" | "error";
  /** The read failed. The panel shows its error, so this state must not claim a clean result. */
  failed?: boolean;
}): ReactElement {
  if (failed) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-3 p-10 text-center"
        role="status"
      >
        <div className="flex size-12 items-center justify-center rounded-full bg-muted/60">
          <FolderGit2 className="size-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">
          {diffScope === "target" ? "Branch changes are unavailable" : "Changes could not load"}
        </p>
      </div>
    );
  }
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

  // Only an action that the user can take earns a second line.
  const description =
    !isLoading &&
    contextMode === "repository" &&
    diffScope === "target" &&
    !targetBranch &&
    upstreamStatus === "untracked"
      ? "Push the branch first to create its upstream."
      : null;

  return (
    <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted/60">
        <FolderGit2 className="size-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        {description ? <p className="text-xs text-muted-foreground/70">{description}</p> : null}
      </div>
    </div>
  );
}
