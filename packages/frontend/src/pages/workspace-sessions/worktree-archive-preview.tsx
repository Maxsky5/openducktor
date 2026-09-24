import type { WorkspaceSessionArchivePreview } from "@openducktor/contracts";
import type { UseQueryResult } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";

export function WorktreeArchivePreview({
  preview,
  removeWorktree,
}: {
  preview: UseQueryResult<WorkspaceSessionArchivePreview>;
  removeWorktree: boolean;
}) {
  return (
    <>
      {preview.isFetching && (
        <p role="status" className="text-sm text-muted-foreground">
          Checking worktree changes…
        </p>
      )}
      {preview.error && (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-sm text-destructive">{errorMessage(preview.error)}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void preview.refetch()}>
            Retry check
          </Button>
        </div>
      )}
      {removeWorktree && preview.data?.hasUncommittedChanges && (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          This worktree has local changes. Removing it will permanently discard them, including
          untracked files.
        </p>
      )}
      {removeWorktree && preview.data && !preview.data.worktreeExists && (
        <p role="alert" className="text-sm text-destructive">
          {preview.data.branchName === null
            ? "The worktree is already missing."
            : "The worktree is already missing. Archiving will finish removing its branch if it still exists."}
        </p>
      )}
    </>
  );
}
