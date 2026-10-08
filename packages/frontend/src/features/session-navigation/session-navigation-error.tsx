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
        className="m-auto grid w-full max-w-lg shrink-0 grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 rounded-xl border border-destructive-border bg-destructive-surface p-4 text-destructive-surface-foreground sm:p-5"
      >
        <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold leading-6">
            {isLoad ? "Couldn't open your conversation" : "Couldn't save your selection"}
          </h2>
          <p className="mt-1 text-sm leading-6">
            {isLoad
              ? "We couldn't load your saved selection. Try again to open your conversation."
              : "We couldn't save which conversation you selected. Try again to save your choice and continue."}
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-3 h-auto min-h-9 max-w-full whitespace-normal border-destructive-surface-foreground/50 bg-transparent text-destructive-surface-foreground shadow-none hover:bg-destructive-surface-foreground/10 hover:text-destructive-surface-foreground focus-visible:ring-destructive-surface-foreground/35"
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
        </div>
        <Collapsible className="col-span-2 mt-4 border-t border-destructive-border pt-2">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="group h-auto min-h-8 w-full justify-between whitespace-normal px-0 text-sm text-destructive-surface-foreground hover:bg-transparent hover:underline focus-visible:ring-destructive-surface-foreground/35"
            >
              Error details
              <ChevronDown
                aria-hidden="true"
                className="size-3.5 group-data-[state=open]:rotate-180"
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 space-y-2 text-xs leading-5">
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
