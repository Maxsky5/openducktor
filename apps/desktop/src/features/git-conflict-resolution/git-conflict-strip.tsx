import { AlertTriangle } from "lucide-react";
import { memo, type ReactElement, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { GitConflict } from "@/features/agent-studio-git";
import { getGitConflictCopy } from "./conflict-copy";
import { GitConflictActions, type GitConflictActionsModel } from "./git-conflict-actions";

type GitConflictStripProps = {
  conflict: GitConflict;
  actions: GitConflictActionsModel;
  onViewDetails: () => void;
};

const toConflictDescription = (conflict: GitConflict): ReactNode => {
  const { operationLabel } = getGitConflictCopy(conflict.operation);
  return (
    <>
      The {operationLabel} onto{" "}
      <span className="font-medium text-foreground">{conflict.targetBranch}</span> is still paused
      on conflicts.
    </>
  );
};

export const GitConflictStrip = memo(function GitConflictStrip({
  conflict,
  actions,
  onViewDetails,
}: GitConflictStripProps): ReactElement {
  return (
    <div
      className="border-b border-amber-200 bg-amber-50 px-3 py-3 dark:border-amber-950 dark:bg-amber-950/20"
      data-testid="agent-studio-git-rebase-strip"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-full bg-amber-100 p-2 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            <AlertTriangle className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-foreground">
                {getGitConflictCopy(conflict.operation).title.replace(
                  " conflict detected",
                  " in progress",
                )}
              </p>
              <span
                className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                data-testid="agent-studio-git-rebase-conflict-count-badge"
              >
                {`${conflict.conflictedFiles.length} conflicted file${conflict.conflictedFiles.length === 1 ? "" : "s"}`}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{toConflictDescription(conflict)}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onViewDetails}
            data-testid="agent-studio-git-view-conflict-details-button"
          >
            View details
          </Button>
          <GitConflictActions
            actions={actions}
            abortTestId="agent-studio-git-abort-rebase-strip-button"
            askBuilderTestId="agent-studio-git-ask-builder-strip-button"
            className="flex items-center gap-2"
          />
        </div>
      </div>
    </div>
  );
});
