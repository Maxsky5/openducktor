import type { IssueItemsListResult, SourceIssue } from "@openducktor/contracts";
import type { UseQueryResult } from "@tanstack/react-query";
import { ExternalLink, Link2, LoaderCircle } from "lucide-react";
import { type ReactElement, useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type IssueImportResultsProps = {
  query: UseQueryResult<IssueItemsListResult, Error>;
  searchText: string;
  searchPending: boolean;
  pageIndex: number;
  selected: Map<string, SourceIssue>;
  onToggle: (item: SourceIssue) => void;
  onOpenSource: (item: SourceIssue) => void;
  onPageChange: (page: number, nextCursor?: string) => void;
};

export function IssueImportResults({
  query,
  searchText,
  searchPending,
  pageIndex,
  selected,
  onToggle,
  onOpenSource,
  onPageChange,
}: IssueImportResultsProps): ReactElement | null {
  if (searchPending || query.isPending || query.isFetching) {
    return (
      <div
        role="status"
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground"
      >
        <LoaderCircle className="size-5 motion-safe:animate-spin" />
        <p>{searchText ? "Searching open items…" : "Loading open items…"}</p>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div role="alert" className="flex flex-col gap-2 p-4 text-sm text-destructive">
        <p>{errorMessage(query.error)}</p>
        <Button type="button" variant="outline" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!query.data) return null;

  return (
    <IssueResultPage
      result={query.data}
      searchText={searchText}
      pageIndex={pageIndex}
      selected={selected}
      onToggle={onToggle}
      onOpenSource={onOpenSource}
      onPageChange={onPageChange}
    />
  );
}

function IssueResultPage({
  result,
  searchText,
  pageIndex,
  selected,
  onToggle,
  onOpenSource,
  onPageChange,
}: Omit<IssueImportResultsProps, "query" | "searchPending"> & {
  result: IssueItemsListResult;
}): ReactElement {
  const { items, nextCursor, incompleteResults } = result;
  const hasPages = pageIndex > 0 || Boolean(nextCursor);

  return (
    <>
      {items.length === 0 ? (
        <p
          role="status"
          className="flex min-h-32 items-center justify-center p-8 text-center text-sm text-muted-foreground"
        >
          {searchText ? "No open items match your search." : "No open items found."}
        </p>
      ) : (
        <ul
          aria-label="Open source items"
          className="min-h-0 max-h-[min(27rem,50dvh)] divide-y divide-border overflow-y-auto overscroll-contain"
        >
          {items.map((item) => (
            <IssueResultRow
              key={item.sourceId}
              item={item}
              selected={selected.has(item.sourceId)}
              onToggle={() => onToggle(item)}
              onOpenSource={() => onOpenSource(item)}
            />
          ))}
        </ul>
      )}
      {incompleteResults ? (
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          The provider returned incomplete results or reached its search limit. Narrow the search to
          find more items.
        </p>
      ) : null}
      {items.length > 0 || hasPages ? (
        <IssueResultPagination
          pageIndex={pageIndex}
          itemCount={items.length}
          nextCursor={nextCursor}
          onPageChange={onPageChange}
        />
      ) : null}
    </>
  );
}

function IssueResultPagination({
  pageIndex,
  itemCount,
  nextCursor,
  onPageChange,
}: {
  pageIndex: number;
  itemCount: number;
  nextCursor: string | undefined;
  onPageChange: (page: number, nextCursor?: string) => void;
}): ReactElement {
  const hasPages = pageIndex > 0 || Boolean(nextCursor);
  return (
    <div className="flex shrink-0 items-center justify-between border-t border-border p-3">
      {hasPages ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pageIndex === 0}
          onClick={() => onPageChange(pageIndex - 1)}
        >
          Previous
        </Button>
      ) : null}
      <span className="text-xs text-muted-foreground">
        {hasPages ? `Page ${pageIndex + 1} · ` : ""}
        {itemCount} {itemCount === 1 ? "item" : "items"}
      </span>
      {hasPages ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!nextCursor}
          onClick={() => {
            if (nextCursor) onPageChange(pageIndex + 1, nextCursor);
          }}
        >
          Next
        </Button>
      ) : null}
    </div>
  );
}

function IssueResultRow({
  item,
  selected,
  onToggle,
  onOpenSource,
}: {
  item: SourceIssue;
  selected: boolean;
  onToggle: () => void;
  onOpenSource: () => void;
}): ReactElement {
  const checkboxId = useId();
  const linkedTaskId = item.linkedTaskId;
  const isLinked = Boolean(linkedTaskId);
  let rowStateClass = "border-l-transparent hover:bg-muted/30 focus-within:bg-muted/30";
  if (isLinked) rowStateClass = "border-l-transparent bg-muted/30";
  else if (selected) rowStateClass = "border-l-primary bg-primary/5";

  return (
    <li
      className={cn(
        "flex items-start gap-3 border-l-2 px-4 py-3.5 transition-colors sm:items-center",
        rowStateClass,
      )}
    >
      <Checkbox
        id={checkboxId}
        className={cn("mt-0.5 shrink-0 sm:mt-0", isLinked && "opacity-45")}
        aria-label={`Select ${item.title}`}
        aria-describedby={isLinked ? `${checkboxId}-linked` : undefined}
        checked={selected}
        disabled={isLinked}
        onCheckedChange={onToggle}
      />
      <Label
        htmlFor={isLinked ? undefined : checkboxId}
        className={cn(
          "min-w-0 flex-1 space-y-1.5",
          isLinked ? "cursor-not-allowed" : "cursor-pointer",
        )}
      >
        <span className="block text-sm leading-snug">
          <span className="mr-1.5 inline-flex rounded border border-border bg-background px-1.5 py-0.5 align-middle font-mono text-[11px] font-medium tabular-nums text-muted-foreground">
            #{item.number}
          </span>
          <span
            className={cn(
              "min-w-0 text-sm font-semibold leading-snug",
              isLinked ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {item.title}
          </span>
          {linkedTaskId ? (
            <Badge
              id={`${checkboxId}-linked`}
              variant="secondary"
              className="ml-1.5 gap-1 px-2 py-0 align-middle text-[11px] font-medium"
              title={`Linked to Task ${linkedTaskId}`}
              aria-label={`Linked to Task ${linkedTaskId}`}
            >
              <Link2 aria-hidden="true" className="size-3" />
              Linked
            </Badge>
          ) : null}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-normal text-muted-foreground">
          <span>{item.creator}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={item.updatedAt}>
            Updated {new Date(item.updatedAt).toLocaleDateString()}
          </time>
          {item.tags.map((tag) => (
            <Badge key={tag} variant="outline" className="px-1.5 py-0 text-[11px] font-normal">
              {tag}
            </Badge>
          ))}
        </span>
      </Label>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
        aria-label={`Open source item ${item.number}`}
        onClick={onOpenSource}
      >
        <ExternalLink className="size-4" />
      </Button>
    </li>
  );
}
