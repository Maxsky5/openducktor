import { useCallback, useState } from "react";

export type WorkflowDialogOwnership = {
  /** The owner of the open shared dialog, or null when no claimed dialog shows. */
  workflowDialogOwner: string | null;
  /** Runs `run`. `owner` owns the shared dialog that `run` opens until the dialog closes. */
  claimWorkflowDialog: (owner: string, run: () => void) => void;
};

/**
 * Records which surface opened the shared workflow dialog.
 *
 * Rule: each action that opens a shared dialog must open it in the same update as the call, not
 * after an `await`. A claim whose run opens no dialog ends at once, so a dialog that opens later
 * has no owner. The Kanban page tests check this rule for each shared dialog.
 *
 * A claimed dialog keeps its owner while shared dialogs replace each other in one update, such as
 * Approve and the git conflict dialog. The claim ends when no shared dialog shows.
 */
export function useWorkflowDialogOwner(workflowDialogOpen: boolean): WorkflowDialogOwnership {
  const [owner, setOwner] = useState<string | null>(null);
  if (owner !== null && !workflowDialogOpen) setOwner(null);
  const claimWorkflowDialog = useCallback((nextOwner: string, run: () => void): void => {
    setOwner(nextOwner);
    run();
  }, []);
  return { workflowDialogOwner: owner, claimWorkflowDialog };
}
