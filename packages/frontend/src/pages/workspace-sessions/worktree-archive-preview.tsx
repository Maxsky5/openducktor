import type { WorkspaceSessionArchivePreview } from "@openducktor/contracts";
import type { UseQueryResult } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import {
  ARCHIVE_CHAT_TEXT,
  worktreeArchiveWarnings,
} from "@openducktor/frontend-core/workspace-sessions/workspace-session-archive-plan";

export function WorktreeArchivePreview({
  preview,
  removeWorktree,
}: {
  preview: UseQueryResult<WorkspaceSessionArchivePreview>;
  removeWorktree: boolean;
}) {
  return (
    <>
      {preview.error && (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-sm text-destructive-muted">{errorMessage(preview.error)}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void preview.refetch()}>
            {ARCHIVE_CHAT_TEXT.retryCheck}
          </Button>
        </div>
      )}
      {worktreeArchiveWarnings(removeWorktree, preview.data).map((warning) =>
        warning.kind === "local_changes" ? (
          <p
            key={warning.kind}
            role="alert"
            className="flex items-start gap-2 text-sm text-destructive-muted"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {warning.text}
          </p>
        ) : (
          <p key={warning.kind} role="alert" className="text-sm text-destructive-muted">
            {warning.text}
          </p>
        ),
      )}
    </>
  );
}
