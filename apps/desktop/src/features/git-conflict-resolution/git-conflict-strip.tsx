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
      className="border-b border-border bg-muted/40 px-4 py-4"
      data-testid={GIT_CONFLICT_TEST_IDS.strip}
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-full bg-amber-500/12 p-2.5 text-amber-600 dark:text-amber-300">
            <AlertTriangle className="size-4" />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-foreground">
                {getGitConflictCopy(conflict.operation).inProgressLabel}
              </p>
              <span
                className="inline-flex max-w-full shrink-0 items-center rounded-full border border-amber-500/20 bg-amber-500/12 px-2.5 py-1 text-xs font-semibold leading-none text-amber-700 dark:text-amber-300"
                data-testid={GIT_CONFLICT_TEST_IDS.conflictCountBadge}
              >
                {`${conflict.conflictedFiles.length} conflicted file${conflict.conflictedFiles.length === 1 ? "" : "s"}`}
              </span>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              {toConflictDescription(conflict)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 xl:justify-end">
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
