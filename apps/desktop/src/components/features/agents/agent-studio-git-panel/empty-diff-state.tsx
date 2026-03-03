import { FolderGit2 } from "lucide-react";
import type { ReactElement } from "react";

export function EmptyDiffState({ isLoading }: { isLoading: boolean }): ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted/60">
        <FolderGit2 className="size-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-muted-foreground">
          {isLoading ? "Scanning for changes..." : "No changes detected"}
        </p>
        <p className="text-xs text-muted-foreground/70">
          {isLoading
            ? "Checking the working directory for file modifications."
            : "File modifications will appear here once the agent starts editing."}
        </p>
      </div>
    </div>
  );
}
