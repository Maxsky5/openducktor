import { ChevronDown, CircleAlert, LoaderCircle, RefreshCcw } from "lucide-react";
import { type ReactElement, useId } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
      <Card
        role="alert"
        aria-labelledby={titleId}
        className="m-auto w-full max-w-lg shrink-0 bg-card p-5 text-foreground sm:p-6"
      >
        <div className="mb-4 flex size-10 items-center justify-center rounded-full bg-destructive-surface text-destructive-surface-foreground">
          <CircleAlert aria-hidden="true" className="size-5" />
        </div>
        <h2 id={titleId} className="text-lg font-semibold leading-7">
          {isLoad ? "Couldn't open your conversation" : "Couldn't save your selection"}
        </h2>
        <p className="mt-2 text-sm leading-6">
          {isLoad
            ? "We couldn't load your saved selection. Try again to open your conversation."
            : "We couldn't save which conversation you selected. Try again to save your choice and continue."}
        </p>
        <div className="mt-5">
          <Button type="button" disabled={isPending} onClick={onRetry}>
            {isPending ? (
              <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
            ) : (
              <RefreshCcw aria-hidden="true" className="size-4" />
            )}
            {isPending ? "Trying again…" : "Try again"}
          </Button>
        </div>
        <Collapsible className="mt-5 border-t border-border pt-3">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group -ml-2 text-sm text-muted-foreground">
              Error details
              <ChevronDown
                aria-hidden="true"
                className="size-3.5 group-data-[state=open]:rotate-180"
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 space-y-3 rounded-md bg-muted p-3 text-xs leading-5">
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
      </Card>
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
