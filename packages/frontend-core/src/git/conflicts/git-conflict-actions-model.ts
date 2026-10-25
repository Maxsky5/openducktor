import { BUILTIN_ROLE_LABELS } from "@openducktor/workflows";
import type { GitConflictAction, GitConflictOperation } from "../contracts";
import { getGitConflictCopy, UNIDENTIFIED_GIT_CONFLICT_ASK_BLOCKED_REASON } from "./conflict-copy";

export type GitConflictActionsModel = {
  isDisabled: boolean;
  abort: ActionControl;
  help?: ActionControl & {
    recipientLabel: string;
    blockedReason: string | null;
  };
};

export const createGitConflictActionsModel = ({
  operation,
  isHandlingConflict,
  conflictAction,
  onAbort,
  onAsk,
  recipientLabel = BUILTIN_ROLE_LABELS.build,
  blockedReason = null,
  isStarting = false,
}: {
  operation: GitConflictOperation | null;
  isHandlingConflict: boolean;
  conflictAction: GitConflictAction | undefined;
  onAbort: () => void;
  onAsk?: (() => void) | undefined;
  recipientLabel?: string | undefined;
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
    let label = "Resolve conflicts";
    if (conflictAction === "ask_builder")
      label = isStarting ? "Starting agent..." : `Sending to ${recipientLabel}...`;
    actions.help = {
      isDisabled: isHandlingConflict || blockedReason !== null || operation === null,
      recipientLabel,
      blockedReason:
        operation === null ? UNIDENTIFIED_GIT_CONFLICT_ASK_BLOCKED_REASON : blockedReason,
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
