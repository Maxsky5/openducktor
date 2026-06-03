import { LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import { memo, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import type { GitConflictActionsModel } from "./git-conflict-actions-model";

type GitConflictActionsProps = {
  actions: GitConflictActionsModel;
  abortTestId: string;
  askBuilderTestId: string;
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
};

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
