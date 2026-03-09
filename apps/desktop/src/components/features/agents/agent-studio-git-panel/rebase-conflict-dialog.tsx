import { memo, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AgentStudioRebaseConflict } from "@/pages/agents/use-agent-studio-git-actions";
import { RebaseConflictActions, type RebaseConflictActionsModel } from "./rebase-conflict-actions";

type RebaseConflictDialogProps = {
  conflict: AgentStudioRebaseConflict | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: RebaseConflictActionsModel;
};

const toConflictTitle = (conflict: AgentStudioRebaseConflict): string =>
  `${conflict.operation === "pull_rebase" ? "Pull with rebase" : "Rebase"} conflict detected`;

const toConflictDescription = (conflict: AgentStudioRebaseConflict): string => {
  if (conflict.operation === "pull_rebase") {
    return `The pull with rebase onto \`${conflict.targetBranch}\` stopped on conflicts. Abort the rebase or send the conflict to Builder for resolution.`;
  }

  return `The rebase onto \`${conflict.targetBranch}\` stopped on conflicts. Abort the rebase or send the conflict to Builder for resolution.`;
};

export const RebaseConflictDialog = memo(function RebaseConflictDialog({
  conflict,
  open,
  onOpenChange,
  actions,
}: RebaseConflictDialogProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" data-testid="agent-studio-git-rebase-conflict-modal">
        <DialogHeader>
          <DialogTitle>
            {conflict ? toConflictTitle(conflict) : "Rebase conflict detected"}
          </DialogTitle>
          <DialogDescription>{conflict ? toConflictDescription(conflict) : null}</DialogDescription>
        </DialogHeader>

        {conflict ? (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-foreground">Conflicted files</p>
              <ul
                className="mt-2 max-h-40 list-disc space-y-1 overflow-auto pl-5 text-sm text-muted-foreground"
                data-testid="agent-studio-git-rebase-conflict-files"
              >
                {conflict.conflictedFiles.map((file) => (
                  <li key={file}>{file}</li>
                ))}
              </ul>
            </div>

            <div>
              <p className="text-sm font-medium text-foreground">Git output</p>
              <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs text-foreground whitespace-pre-wrap">
                {conflict.output}
              </pre>
            </div>
          </div>
        ) : null}

        <DialogFooter className="mt-6 flex flex-row items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={actions.isDisabled}
            data-testid="agent-studio-git-close-rebase-conflict-modal-button"
          >
            Close
          </Button>

          <RebaseConflictActions
            actions={actions}
            abortTestId="agent-studio-git-abort-rebase-button"
            askBuilderTestId="agent-studio-git-ask-builder-button"
            size="default"
            className="flex items-center gap-2"
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
