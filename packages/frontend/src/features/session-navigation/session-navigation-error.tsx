import { AlertTriangle, RefreshCcw } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";

export function SessionNavigationError({
  scopeLabel,
  repositoryPath,
  error,
  onRetry,
  isPending = false,
}: SessionNavigationErrorProps): ReactElement {
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-card p-4">
      <div
        role="alert"
        className="flex w-full max-w-2xl flex-col gap-4 rounded-xl border border-destructive-border bg-destructive-surface p-4 text-sm text-destructive-muted"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0 space-y-2">
            <p className="font-medium text-destructive">
              {scopeLabel} couldn&apos;t restore the saved navigation context.
            </p>
            {repositoryPath ? <p>{`Repository: ${repositoryPath}`}</p> : null}
            <p className="break-words font-mono text-xs">{error.message}</p>
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            className="border-destructive-border bg-card text-destructive-muted hover:bg-destructive-surface"
            onClick={onRetry}
          >
            <RefreshCcw className="size-3.5" />
            {isPending ? "Restoring…" : "Retry restore"}
          </Button>
        </div>
      </div>
    </div>
  );
}

type SessionNavigationErrorProps = {
  scopeLabel: string;
  repositoryPath: string | null;
  error: Error;
  onRetry: () => void;
  isPending?: boolean;
};
