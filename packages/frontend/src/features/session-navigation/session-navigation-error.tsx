import { ChevronDown, CircleAlert, LoaderCircle, RefreshCcw } from "lucide-react";
import { type ReactElement, useId } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { SessionNavigationRecovery } from "./use-session-navigation-recovery";

export function SessionNavigationError({
  scopeLabel,
  repositoryPath,
  error,
  operation,
  onRetry,
  isPending = false,
}: SessionNavigationErrorProps): ReactElement {
  const titleId = useId();
  const isLoad = operation === "load";
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background/40 p-4 sm:p-6">
      <div
        role="alert"
        aria-labelledby={titleId}
        className="m-auto flex w-full max-w-xl shrink-0 gap-3 rounded-xl border border-destructive-border bg-destructive-surface p-4 text-destructive-surface-foreground sm:p-5"
      >
        <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-base font-semibold leading-6">
            {isLoad ? "Couldn't open your conversation" : "Couldn't save your selection"}
          </h2>
          <p className="mt-1 text-sm leading-6">
            {isLoad
              ? "We couldn't load your saved selection. Try again to open your conversation."
              : "We couldn't save which conversation you selected. Try again to save your choice and continue."}
          </p>
          <Collapsible className="mt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-auto min-h-9 max-w-full whitespace-normal"
                disabled={isPending}
                onClick={onRetry}
              >
                {isPending ? (
                  <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
                ) : (
                  <RefreshCcw aria-hidden="true" className="size-4" />
                )}
                {isPending ? "Trying again…" : "Try again"}
              </Button>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="group h-auto min-h-8 max-w-full whitespace-normal text-sm text-destructive-surface-foreground hover:bg-destructive-accent/10"
                >
                  Error details
                  <ChevronDown
                    aria-hidden="true"
                    className="size-3.5 group-data-[state=open]:rotate-180"
                  />
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent>
              <div className="mt-4 space-y-3 border-t border-destructive-border pt-3 text-xs leading-5">
                <p>{scopeLabel}</p>
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{error.message}</p>
                {repositoryPath ? (
                  <dl>
                    <dt className="font-medium">Repository</dt>
                    <dd className="[overflow-wrap:anywhere]">{repositoryPath}</dd>
                  </dl>
                ) : null}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>
    </div>
  );
}

type SessionNavigationErrorProps = {
  scopeLabel: string;
  repositoryPath: string | null;
  error: Error;
  operation: SessionNavigationRecovery["navigationPersistenceOperation"];
  onRetry: () => void;
  isPending?: boolean;
};
