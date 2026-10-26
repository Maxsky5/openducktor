import { FolderGit2 } from "lucide-react";
import type { ReactElement } from "react";
import type { DiffScope } from "@openducktor/frontend-core/git/contracts";
import { emptyDiffCopy } from "@openducktor/frontend-core/git/model/empty-diff-copy";

/**
 * A list whose read failed. The panel shows the error, so this state must not claim a clean
 * result.
 */
export function DiffLoadFailedState({ diffScope }: { diffScope: DiffScope }): ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-10 text-center" role="status">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted/60">
        <FolderGit2 className="size-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-muted-foreground">
        {diffScope === "target" ? "Branch changes are unavailable" : "Changes could not load"}
      </p>
    </div>
  );
}

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
  const { title, description } = emptyDiffCopy({
    targetBranch: targetBranch ?? "",
    isLoading,
    contextMode,
    diffScope,
    upstreamStatus,
  });

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
