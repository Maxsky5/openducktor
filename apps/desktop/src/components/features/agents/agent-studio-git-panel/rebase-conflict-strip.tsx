import { memo, type ReactElement, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AgentStudioRebaseConflict } from "@/pages/agents/use-agent-studio-git-actions";
import { INLINE_CODE_CLASS_NAME } from "./constants";
import { RebaseConflictActions, type RebaseConflictActionsModel } from "./rebase-conflict-actions";

type RebaseConflictStripProps = {
  conflict: AgentStudioRebaseConflict;
  actions: RebaseConflictActionsModel;
  onViewDetails: () => void;
};

const toConflictDescription = (conflict: AgentStudioRebaseConflict): ReactNode => {
  const operationLabel = conflict.operation === "pull_rebase" ? "pull with rebase" : "rebase";

  return (
    <>
      The {operationLabel} onto{" "}
      <code className={INLINE_CODE_CLASS_NAME}>{conflict.targetBranch}</code> is paused on
      conflicts.
    </>
  );
};

export const RebaseConflictStrip = memo(function RebaseConflictStrip({
  conflict,
  actions,
  onViewDetails,
}: RebaseConflictStripProps): ReactElement {
  const label = conflict.operation === "pull_rebase" ? "Pull with rebase" : "Rebase";
  const conflictedFileCount = conflict.conflictedFiles.length;

  return (
    <div
      className="border-b border-border bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
      data-testid="agent-studio-git-rebase-strip"
    >
      <div className="space-y-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{label} in progress</p>
            <Badge
              variant="warning"
              className="px-2 py-0.5 text-[10px]"
              data-testid="agent-studio-git-rebase-conflict-count-badge"
            >
              {conflictedFileCount} conflicted file{conflictedFileCount === 1 ? "" : "s"}
            </Badge>
          </div>
          <p className="text-xs text-amber-800 dark:text-amber-200">
            {toConflictDescription(conflict)}
          </p>
        </div>

        <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-0.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={onViewDetails}
            disabled={actions.isDisabled}
            data-testid="agent-studio-git-view-conflict-details-button"
          >
            View details
          </Button>
          <RebaseConflictActions
            actions={actions}
            abortTestId="agent-studio-git-abort-rebase-strip-button"
            askBuilderTestId="agent-studio-git-ask-builder-strip-button"
            size="sm"
            className="flex items-center gap-2"
          />
        </div>
      </div>
    </div>
  );
});
