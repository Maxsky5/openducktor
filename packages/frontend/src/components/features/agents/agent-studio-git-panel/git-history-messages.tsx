import { History, LoaderCircle, RefreshCw } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { HistoryFooter } from "./git-history-footer";

export function HistoryRefreshFailure({
  message,
  isRefreshing,
  onRefresh,
}: {
  message: string;
  isRefreshing: boolean;
  onRefresh: () => void;
}): ReactElement {
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center gap-2 border-b border-border bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
      data-testid="agent-studio-git-history-refresh-error"
    >
      <p className="line-clamp-2 min-w-0 flex-1 break-words" title={message}>
        Refresh failed: {message}
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-destructive hover:text-destructive"
        aria-label={isRefreshing ? "Refreshing History" : "Refresh History"}
        title="Refresh History"
        disabled={isRefreshing}
        onClick={onRefresh}
      >
        <RefreshCw className={cn("size-3.5", isRefreshing && "animate-spin")} />
      </Button>
    </div>
  );
}

export function RetainedHistoryMessage({
  refreshFailure,
  children,
}: {
  refreshFailure: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {refreshFailure}
      {children}
    </div>
  );
}

export function HistoryFooterRow({ footer }: { footer: HistoryFooter }): ReactElement | null {
  if (footer.kind === "loading") {
    return (
      <p
        role="status"
        className="flex h-full items-center gap-2 px-3 text-xs text-muted-foreground"
      >
        <LoaderCircle className="size-3.5 animate-spin" />
        Loading older commits...
      </p>
    );
  }
  if (footer.kind === "error") {
    return (
      <div role="alert" className="flex h-full items-center gap-2 px-3 text-xs text-destructive">
        <span className="min-w-0 flex-1 truncate" title={footer.message}>
          Older commits could not load: {footer.message}
        </span>
        <Button type="button" variant="outline" size="sm" className="h-7" onClick={footer.retry}>
          Retry
        </Button>
      </div>
    );
  }
  if (footer.kind === "paused") {
    return (
      <p className="flex h-full items-center px-3 text-xs text-muted-foreground">
        Refresh History to load older commits.
      </p>
    );
  }
  if (footer.kind === "more") {
    return (
      <div className="flex h-full items-center px-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={footer.load}
        >
          Load older commits
        </Button>
      </div>
    );
  }
  // The view adds no row for the end, because the shared base row ends the list.
  return null;
}

/** The loading state of History, in the layout of the loading states of the other tabs. */
export function HistoryLoading({ label }: { label: string }): ReactElement {
  return <HistoryMessage title={label} tone="muted" />;
}

/** A History state in the layout of the empty and loading states of the other tabs. */
export function HistoryMessage({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "muted" | "error";
  children?: ReactNode;
}): ReactElement {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className="flex flex-col items-center justify-center gap-3 p-10 text-center"
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-muted/60">
        <History className="size-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        {children ? (
          <div
            className={cn(
              "mx-auto flex max-w-80 flex-col items-center text-xs",
              tone === "error" ? "text-destructive" : "text-muted-foreground/70",
            )}
          >
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}
