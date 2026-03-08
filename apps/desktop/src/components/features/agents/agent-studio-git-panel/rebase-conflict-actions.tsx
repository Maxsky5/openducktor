import { LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import { memo, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import type { AgentStudioRebaseConflictAction } from "@/pages/agents/use-agent-studio-git-actions";

export type RebaseConflictActionsModel = {
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

type RebaseConflictActionsProps = {
  actions: RebaseConflictActionsModel;
  abortTestId: string;
  askBuilderTestId: string;
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
};

export const createRebaseConflictActionsModel = ({
  isHandlingRebaseConflict,
  rebaseConflictAction,
  onAbort,
  onAskBuilder,
}: {
  isHandlingRebaseConflict: boolean;
  rebaseConflictAction: AgentStudioRebaseConflictAction | undefined;
  onAbort: () => void;
  onAskBuilder: () => void;
}): RebaseConflictActionsModel => ({
  isDisabled: isHandlingRebaseConflict,
  abort: {
    isPending: rebaseConflictAction === "abort",
    label: rebaseConflictAction === "abort" ? "Aborting..." : "Abort rebase",
    onClick: onAbort,
  },
  askBuilder: {
    isPending: rebaseConflictAction === "ask_builder",
    label:
      rebaseConflictAction === "ask_builder" ? "Sending to Builder..." : "Ask Builder to resolve",
    onClick: onAskBuilder,
  },
});

export const RebaseConflictActions = memo(function RebaseConflictActions({
  actions,
  abortTestId,
  askBuilderTestId,
  size = "sm",
  className,
}: RebaseConflictActionsProps): ReactElement {
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
