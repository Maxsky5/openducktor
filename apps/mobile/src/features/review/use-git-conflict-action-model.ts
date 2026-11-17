import { getGitConflictCopy } from "@openducktor/frontend-core/git/conflicts/conflict-copy";
import { createGitConflictActionsModel } from "@openducktor/frontend-core/git/conflicts/git-conflict-actions-model";
import type { GitConflict } from "@openducktor/frontend-core/git/contracts";
import { useConfirm } from "@/ui/confirm-dialog";
import type { GitConflictActions } from "./use-git-conflict-actions";

export function useGitConflictActionModel(
  conflict: GitConflict,
  actions: GitConflictActions,
  recipientLabel: "Builder" | "agent",
) {
  const confirm = useConfirm();
  const copy = getGitConflictCopy(conflict.operation);
  const model = createGitConflictActionsModel({
    operation: conflict.operation,
    isHandlingConflict: actions.action !== null,
    conflictAction: actions.action,
    onAbort: () => {
      void confirm({
        title: copy.abortLabel,
        message: `This cancels the ${copy.operationLabel} and restores the branch to its earlier state.`,
        confirmLabel: copy.abortLabel,
        icon: "rotate-ccw",
        destructive: true,
      }).then((confirmed) => {
        if (confirmed) void actions.abort();
      });
    },
    onAsk: () => {
      void confirm({
        title: `Ask the ${recipientLabel} to resolve the conflict?`,
        message: actions.askDescription,
        confirmLabel: "Send request",
        icon: "send",
      }).then((confirmed) => {
        if (confirmed) void actions.askAgent();
      });
    },
    recipientLabel,
    blockedReason: actions.askBlockedReason,
  });
  return { copy, model, help: model.help };
}
