import { memo, type ReactElement, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { GitConflict } from "@/features/agent-studio-git";
import { getGitConflictCopy, getGitConflictTitle } from "./conflict-copy";
import { GIT_CONFLICT_TEST_IDS, INLINE_CODE_CLASS_NAME } from "./constants";
import { GitConflictActions, type GitConflictActionsModel } from "./git-conflict-actions";

type GitConflictDialogProps = {
  conflict: GitConflict | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: GitConflictActionsModel;
  testId?: string;
  abortTestId?: string;
  askBuilderTestId?: string;
};

const toConflictDescription = (conflict: GitConflict): ReactNode => {
  const { operationLabel } = getGitConflictCopy(conflict.operation);

  return (
    <>
      The {operationLabel} onto{" "}
      <code className={INLINE_CODE_CLASS_NAME}>{conflict.targetBranch}</code> stopped on conflicts.
      Abort the git operation or send the conflict to Builder for resolution.
    </>
  );
};

export const GitConflictDialog = memo(function GitConflictDialog({
  conflict,
  open,
  onOpenChange,
  actions,
  testId = GIT_CONFLICT_TEST_IDS.dialog,
  abortTestId = GIT_CONFLICT_TEST_IDS.abortButton,
  askBuilderTestId = GIT_CONFLICT_TEST_IDS.askBuilderButton,
}: GitConflictDialogProps): ReactElement {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && actions.isDisabled) {
          return;
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-xl" data-testid={testId}>
        <DialogHeader>
          <DialogTitle>
            {conflict ? getGitConflictTitle(conflict) : "Git conflict detected"}
          </DialogTitle>
          <DialogDescription>{conflict ? toConflictDescription(conflict) : null}</DialogDescription>
        </DialogHeader>

        {conflict ? (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-foreground">Conflicted files</p>
              <ul className="mt-2 max-h-40 list-disc space-y-1 overflow-auto pl-5 text-sm text-muted-foreground">
                {conflict.conflictedFiles.map((file) => (
                  <li key={file}>{file}</li>
                ))}
              </ul>
            </div>

            <div>
              <p className="text-sm font-medium text-foreground">Git output</p>
              <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap text-foreground">
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
          >
            Close
          </Button>

          <GitConflictActions
            actions={actions}
            abortTestId={abortTestId}
            askBuilderTestId={askBuilderTestId}
            size="default"
            className="flex items-center gap-2"
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
