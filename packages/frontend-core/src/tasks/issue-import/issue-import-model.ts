import type { IssueItemsListResult, SourceIssue } from "@openducktor/contracts";
import { type QueryKey, queryOptions } from "@tanstack/react-query";
import { connectionHost } from "../../connection/client-connection";
import { issueItemsQueryKeys } from "../../queries/issue-items";
import { SKIPPED_QUERY_KEY_SEGMENT, skippedQueryOptions } from "../../queries/skipped-query";
import type { IssueImportProvider } from "./issue-import-provider";
import { issueImportProviderCopy, issueImportSourceLabel } from "./issue-import-provider";
import type { ImportOutcome, IssueReview } from "./issue-import-state";

/** The import first selects source items, then reviews each task before import. */
export type IssueImportStep = "select" | "review";

/** The issue types that an imported task can have, in display order. */
export const ISSUE_IMPORT_ISSUE_TYPES = [
  "feature",
  "bug",
  "task",
] as const satisfies readonly IssueReview["issueType"][];

export const ISSUE_IMPORT_LABELS = {
  back: "Back",
  reviewTasks: "Review tasks",
  importSelected: "Import selected",
  importing: "Importing…",
  openRepositorySettings: "Open repository settings",
  retry: "Retry",
  previousPage: "Previous",
  nextPage: "Next",
  remove: "Remove",
  description: "Description",
  noDescription: "No description",
  issueType: "Issue type",
  priority: "Priority",
  labels: "Labels",
  refreshItem: "Refresh item",
  refreshingItem: "Refreshing…",
  linked: "Linked",
  openSourceFailed: "Failed to open source item",
} as const;

export const ISSUE_IMPORT_INCOMPLETE_RESULTS_TEXT =
  "The provider returned incomplete results or reached its search limit. Narrow the search to find more items.";

/**
 * Why the provider cannot list items to import, or null when it can. A provider whose issue
 * connection works can import even when its repository mapping is not valid for pull requests.
 */
export const issueImportUnavailableReason = (provider: IssueImportProvider): string | null => {
  if (provider.config.id === "azure_devops" && !provider.config.settings?.areaPath) {
    return "Choose an Azure DevOps area path in repository settings before importing work items.";
  }
  const issueConnectionReady =
    provider.config.enabled &&
    provider.config.repository &&
    provider.health.authenticated &&
    provider.health.repositoryMappingValid === false;
  if (!provider.health.available && !issueConnectionReady) {
    return (
      provider.health.reason ?? "Connect the Git provider in repository settings before importing."
    );
  }
  return null;
};

/** The open source items of one result page of a search. */
export const issueImportListQueryOptions = ({
  workspaceId,
  repoPath,
  provider,
  search,
  cursor,
}: {
  workspaceId: string;
  repoPath: string;
  provider: IssueImportProvider | null;
  search: string;
  cursor: string | undefined;
}) =>
  provider === null
    ? skippedQueryOptions<IssueItemsListResult>({
        queryKey: [
          ...issueItemsQueryKeys.repo({ workspaceId, repoPath }),
          SKIPPED_QUERY_KEY_SEGMENT,
        ],
        staleTime: Number.POSITIVE_INFINITY,
      })
    : queryOptions<IssueItemsListResult, Error, IssueItemsListResult, QueryKey>({
        queryKey: [
          ...issueItemsQueryKeys.repo({ workspaceId, repoPath }),
          provider.config.id,
          provider.config.repository,
          provider.config.settings?.areaPath,
          search,
          cursor,
        ],
        queryFn: ({ client }) =>
          connectionHost(client).issueItemsList({ workspaceId, repoPath, search, cursor }),
      });

/**
 * The selected items, with the task link that the current result page shows. Another client can
 * import an item after this client selected it.
 */
export const selectedItemsWithCurrentLinks = (
  selected: ReadonlyMap<string, SourceIssue>,
  items: readonly SourceIssue[],
): SourceIssue[] => {
  const linkedOnPage = new Map<string, string>();
  for (const item of items) {
    if (item.linkedTaskId) linkedOnPage.set(item.sourceId, item.linkedTaskId);
  }
  return [...selected.values()].map((item) => {
    const linkedTaskId = linkedOnPage.get(item.sourceId);
    return linkedTaskId ? { ...item, linkedTaskId } : item;
  });
};

/** The page cursors after a move to the next page. Earlier pages keep their cursors. */
export const nextIssueImportCursors = (
  cursors: readonly (string | undefined)[],
  pageIndex: number,
  nextCursor: string,
): Array<string | undefined> => [...cursors.slice(0, pageIndex + 1), nextCursor];

export const issueImportTitle = (providerId: string): string =>
  `Import from ${issueImportSourceLabel(providerId)}`;

export const issueImportStepDescription = (step: IssueImportStep): string =>
  step === "select"
    ? "Choose items to import. Your selections stay when you search or change pages."
    : "Review each task before importing.";

/** The search field of a provider that can search, or null when it lists items only. */
export const issueImportSearchField = (
  provider: IssueImportProvider,
): { label: string; placeholder: string } | null => {
  if (provider.descriptor.capabilities.issueAccess !== "search") return null;
  return issueImportProviderCopy(provider.config.id).search;
};

export const issueImportLoadingText = (searchText: string): string =>
  searchText ? "Searching open items…" : "Loading open items…";

export const issueImportEmptyText = (searchText: string): string =>
  searchText ? "No open items match your search." : "No open items found.";

export const issueImportHasPages = (pageIndex: number, nextCursor: string | undefined): boolean =>
  pageIndex > 0 || Boolean(nextCursor);

/** The page and item count below the results, such as "Page 2 · 25 items". */
export const issueImportPageSummary = (
  pageIndex: number,
  itemCount: number,
  hasPages: boolean,
): string =>
  `${hasPages ? `Page ${pageIndex + 1} · ` : ""}${itemCount} ${itemCount === 1 ? "item" : "items"}`;

export const issueImportItemTitle = (item: Pick<SourceIssue, "number" | "title">): string =>
  `#${item.number} ${item.title}`;

export const issueImportLinkedText = (taskId: string): string => `Linked to Task ${taskId}`;

export const issueImportUpdatedText = (updatedAt: string): string =>
  `Updated ${new Date(updatedAt).toLocaleDateString()}`;

export const issueImportSelectedTitle = (count: number): string => `Selected (${count})`;

/** The result of one reviewed item, or null before an import or refresh reports one. */
export type IssueImportReviewStatus = { kind: "created" | "failed"; text: string };

export const issueImportReviewStatus = (
  item: Pick<SourceIssue, "linkedTaskId">,
  outcome: ImportOutcome | undefined,
): IssueImportReviewStatus | null => {
  if (outcome?.outcome === "created") {
    return { kind: "created", text: `Created Task ${outcome.taskId}` };
  }
  if (item.linkedTaskId) {
    return { kind: "failed", text: `Already linked to Task ${item.linkedTaskId}` };
  }
  if (outcome?.outcome === "failed") return { kind: "failed", text: outcome.reason };
  return null;
};

export const issueImportCreatedMessage = (createdCount: number): string =>
  `${createdCount} ${createdCount === 1 ? "Task" : "Tasks"} created`;
