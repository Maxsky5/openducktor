import { AlertCircle, GitPullRequest, Loader2, RefreshCw, WifiOff } from "lucide-react";
import type { ComponentType, ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type TaskExecutionCiPanelStateKind = "empty" | "error" | "loading" | "unavailable";

export type TaskExecutionCiPanelStateProps = {
  title: string;
  message: string;
  kind?: TaskExecutionCiPanelStateKind;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
};

type StateVisual = {
  icon: ComponentType<{ className?: string }>;
  iconClassName?: string;
  iconShellClassName?: string;
};

const STATE_VISUALS: Record<TaskExecutionCiPanelStateKind, StateVisual> = {
  empty: {
    icon: GitPullRequest,
  },
  error: {
    icon: AlertCircle,
    iconShellClassName: "bg-destructive/10 text-destructive",
  },
  loading: {
    icon: Loader2,
    iconClassName: "animate-spin",
  },
  unavailable: {
    icon: WifiOff,
  },
};

function LoadingPreview(): ReactElement {
  return (
    <div className="mt-3 w-full space-y-2" aria-hidden="true">
      <div className="h-8 rounded-md bg-muted" />
      <div className="h-8 rounded-md bg-muted" />
      <div className="h-8 rounded-md bg-muted" />
    </div>
  );
}

export function TaskExecutionCiPanelState({
  actionLabel,
  detail,
  kind = "empty",
  message,
  onAction,
  title,
}: TaskExecutionCiPanelStateProps): ReactElement {
  const visual = STATE_VISUALS[kind];
  const Icon = visual.icon;
  const canAct = actionLabel !== undefined && onAction !== undefined;

  return (
    <div className="flex h-full min-h-0 flex-col px-5 py-6">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center text-center">
        <div
          className={cn(
            "flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground",
            visual.iconShellClassName,
          )}
        >
          <Icon className={cn("size-5", visual.iconClassName)} />
        </div>
        <h3 className="mt-3 text-sm font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{message}</p>
        {detail ? (
          <pre className="mt-3 max-h-32 w-full overflow-auto whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-left font-mono text-xs leading-5 text-muted-foreground">
            {detail}
          </pre>
        ) : null}
        {kind === "loading" ? <LoadingPreview /> : null}
        {canAct ? (
          <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onAction}>
            <RefreshCw className="size-3.5" />
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
