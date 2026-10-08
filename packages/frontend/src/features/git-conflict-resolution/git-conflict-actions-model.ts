import type { GitConflictAction, GitConflictOperation } from "@/features/agent-studio-git";
import { getGitConflictCopy } from "./conflict-copy";

export type GitConflictActionsModel = {
  isDisabled: boolean;
  abort: ActionControl;
  help?: ActionControl & {
    recipientLabel: "Builder" | "agent";
    blockedReason: string | null;
  };
};

export const createGitConflictActionsModel = ({
  operation,
  isHandlingConflict,
  conflictAction,
  onAbort,
  onAsk,
  recipientLabel = "Builder",
  blockedReason = null,
  isStarting = false,
}: {
  operation: GitConflictOperation | null;
  isHandlingConflict: boolean;
  conflictAction: GitConflictAction | undefined;
  onAbort: () => void;
  onAsk?: (() => void) | undefined;
  recipientLabel?: "Builder" | "agent" | undefined;
  blockedReason?: string | null | undefined;
  isStarting?: boolean | undefined;
}): GitConflictActionsModel => {
  const actions: GitConflictActionsModel = {
    isDisabled: isHandlingConflict,
    abort: {
      isDisabled: isHandlingConflict || operation === null,
      isPending: conflictAction === "abort",
      label: conflictAction === "abort" ? "Aborting..." : getGitConflictCopy(operation).abortLabel,
      onClick: onAbort,
    },
  };
  if (onAsk) {
    let label =
      recipientLabel === "agent" ? "Ask agent" : getGitConflictCopy(operation).askBuilderLabel;
    if (conflictAction === "ask_builder")
      label = isStarting ? "Starting agent..." : `Sending to ${recipientLabel}...`;
    actions.help = {
      isDisabled: isHandlingConflict || blockedReason !== null || operation === null,
      recipientLabel,
      blockedReason:
        operation === null
          ? "Git did not report the conflict operation. Restore the operation information before asking for assistance."
          : blockedReason,
      isPending: conflictAction === "ask_builder",
      label,
      onClick: onAsk,
    };
  }
  return actions;
};

type ActionControl = {
  isDisabled: boolean;
  isPending: boolean;
  label: string;
  onClick: () => void;
};
