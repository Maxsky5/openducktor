import { LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import { memo, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
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

type GitConflictActionsProps = {
  actions: GitConflictActionsModel;
  abortTestId: string;
  askBuilderTestId: string;
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
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

export const GitConflictActions = memo(function GitConflictActions({
  actions,
  abortTestId,
  askBuilderTestId,
  size = "sm",
  className,
}: GitConflictActionsProps): ReactElement {
  return (
    <div className={className}>
      <Button
        type="button"
        variant="outline"
        size={size}
        onClick={actions.abort.onClick}
        disabled={actions.isDisabled}
        data-testid={abortTestId}
      >
        {actions.abort.isPending ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <RotateCcw className="size-4" />
        )}
        {actions.abort.label}
      </Button>
      <Button
        type="button"
        size={size}
        onClick={actions.askBuilder.onClick}
        disabled={actions.isDisabled}
        data-testid={askBuilderTestId}
      >
        {actions.askBuilder.isPending ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <Sparkles className="size-4" />
        )}
        {actions.askBuilder.label}
      </Button>
    </div>
  );
});
