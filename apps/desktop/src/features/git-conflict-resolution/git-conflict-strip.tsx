import { AlertTriangle } from "lucide-react";
import { memo, type ReactElement, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { GitConflict } from "@/features/agent-studio-git";
import { getGitConflictCopy } from "./conflict-copy";
import { GIT_CONFLICT_TEST_IDS } from "./constants";
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
      className="border-b border-border bg-muted px-3 py-3"
      data-testid={GIT_CONFLICT_TEST_IDS.strip}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-full bg-destructive/10 p-2 text-destructive">
            <AlertTriangle className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-foreground">
                {getGitConflictCopy(conflict.operation).inProgressLabel}
              </p>
              <span
                className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
                data-testid={GIT_CONFLICT_TEST_IDS.conflictCountBadge}
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
            abortTestId={GIT_CONFLICT_TEST_IDS.abortStripButton}
            askBuilderTestId={GIT_CONFLICT_TEST_IDS.askBuilderStripButton}
            className="flex items-center gap-2"
          />
        </div>
      </div>
    </div>
  );
});
