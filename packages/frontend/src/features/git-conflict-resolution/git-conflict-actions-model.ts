import type { GitConflictAction, GitConflictOperation } from "@/features/agent-studio-git";
import { getGitConflictCopy } from "./conflict-copy";

export type GitConflictActionsModel = {
  isDisabled: boolean;
  abort: {
    isPending: boolean;
    label: string;
    onClick: () => void;
  };
  askBuilder: {
    isPending: boolean;
    label: string;
    onClick: () => void;
  };
};

export const createGitConflictActionsModel = ({
  operation,
  isHandlingConflict,
  conflictAction,
  onAbort,
  onAskBuilder,
}: {
  operation: GitConflictOperation;
  isHandlingConflict: boolean;
  conflictAction: GitConflictAction | undefined;
  onAbort: () => void;
  onAskBuilder: () => void;
}): GitConflictActionsModel => ({
  isDisabled: isHandlingConflict,
  abort: {
    isPending: conflictAction === "abort",
    label: conflictAction === "abort" ? "Aborting..." : getGitConflictCopy(operation).abortLabel,
    onClick: onAbort,
  },
  askBuilder: {
    isPending: conflictAction === "ask_builder",
    label:
      conflictAction === "ask_builder"
        ? "Sending to Builder..."
        : getGitConflictCopy(operation).askBuilderLabel,
    onClick: onAskBuilder,
  },
});
