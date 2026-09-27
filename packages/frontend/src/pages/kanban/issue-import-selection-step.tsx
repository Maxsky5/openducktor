import type {
  IssueItemsListResult,
  RepositoryGitProviderContext,
  SourceIssue,
} from "@openducktor/contracts";
import type { UseQueryResult } from "@tanstack/react-query";
import { X } from "lucide-react";
import type { Dispatch, ReactElement, SetStateAction } from "react";
import { Badge } from "@/components/ui/badge";
import { SearchField } from "@/components/ui/search-field";
import { IssueImportResults } from "./issue-import-results";

type IssueSelectionStepProps = {
  provider: NonNullable<RepositoryGitProviderContext>;
  query: UseQueryResult<IssueItemsListResult, Error>;
  searchText: string;
  searchPending: boolean;
  setSearchText: Dispatch<SetStateAction<string>>;
  setCursors: Dispatch<SetStateAction<Array<string | undefined>>>;
  setPageIndex: Dispatch<SetStateAction<number>>;
  pageIndex: number;
  selected: Map<string, SourceIssue>;
  selectedItems: SourceIssue[];
  toggleItem: (item: SourceIssue) => void;
  removeItem: (sourceId: string) => void;
  openSource: (item: SourceIssue) => void;
};

export function IssueSelectionStep({
  provider,
  query,
  searchText,
  searchPending,
  setSearchText,
  setCursors,
  setPageIndex,
  pageIndex,
  selected,
  selectedItems,
  toggleItem,
  removeItem,
  openSource,
}: IssueSelectionStepProps): ReactElement {
  const canSearch = provider.descriptor.capabilities.issueAccess === "search";
  const isGithub = provider.config.id === "github";
  const searchLabel = isGithub ? "Search issues" : "Search work items";
  const onPageChange = (page: number, nextCursor?: string): void => {
    if (nextCursor) {
      setCursors((current) => [...current.slice(0, pageIndex + 1), nextCursor]);
    }
    setPageIndex(page);
  };

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border">
        {canSearch ? (
          <div className="grid shrink-0 gap-2.5 border-b border-border bg-muted/20 p-4">
            <SearchField
              id="issue-import-search"
              label={searchLabel}
              value={searchText}
              placeholder={isGithub ? "Search titles or issue numbers" : "Search titles"}
              onValueChange={setSearchText}
            />
          </div>
        ) : null}
        <IssueImportResults
          query={query}
          searchText={searchText}
          searchPending={searchPending}
          pageIndex={pageIndex}
          selected={selected}
          onToggle={toggleItem}
          onOpenSource={openSource}
          onPageChange={onPageChange}
        />
      </div>
      <SelectedIssues items={selectedItems} onRemove={removeItem} />
    </div>
  );
}

function SelectedIssues({
  items,
  onRemove,
}: {
  items: SourceIssue[];
  onRemove: (sourceId: string) => void;
}): ReactElement | null {
  if (items.length === 0) return null;

  return (
    <div className="flex max-h-32 shrink-0 flex-col gap-2 overflow-y-auto border-t border-border pt-3">
      <p className="text-sm font-medium text-foreground">Selected ({items.length})</p>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <Badge key={item.sourceId} variant="secondary" className="max-w-full gap-1 pr-1">
            <span className="truncate">
              #{item.number} {item.title}
            </span>
            <button
              type="button"
              className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
              onClick={() => onRemove(item.sourceId)}
              aria-label={`Remove ${item.title}`}
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
      </div>
    </div>
  );
}
