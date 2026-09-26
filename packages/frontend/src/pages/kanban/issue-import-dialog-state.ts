import type {
  IssueItemsImportResult,
  RepositoryGitProviderContext,
  SourceIssue,
} from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { host } from "@/state/operations/shared/host";
import { invalidateRepoIssueItemsQueries } from "@/state/queries/issue-items";

export type IssueReview = {
  issueType: "task" | "feature" | "bug";
  priority: number;
  labels: string[];
};

export type ImportOutcome = IssueItemsImportResult["results"][number];

export const initialReview = (item: SourceIssue): IssueReview => ({
  issueType: "task",
  priority: 2,
  labels: [...item.tags],
});

export function useIssueImportSearch() {
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const searchPending = searchText.trim() !== search;

  useEffect(() => {
    if (!searchPending) return;
    const timer = window.setTimeout(() => {
      setSearch(searchText.trim());
      setCursors([undefined]);
      setPageIndex(0);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchPending, searchText]);

  return {
    searchText,
    setSearchText,
    search,
    cursors,
    setCursors,
    pageIndex,
    setPageIndex,
    searchPending,
  };
}

export function useIssueSelectionState() {
  const [entries, setEntries] = useState<Map<string, { item: SourceIssue; review: IssueReview }>>(
    () => new Map(),
  );
  const selected = new Map<string, SourceIssue>();
  const reviews = new Map<string, IssueReview>();
  for (const [sourceId, entry] of entries) {
    selected.set(sourceId, entry.item);
    reviews.set(sourceId, entry.review);
  }
  const toggleItem = (item: SourceIssue): void => {
    setEntries((current) => {
      const next = new Map(current);
      if (next.has(item.sourceId)) next.delete(item.sourceId);
      else next.set(item.sourceId, { item, review: initialReview(item) });
      return next;
    });
  };
  const removeItem = (sourceId: string): void => {
    setEntries((current) => {
      if (!current.has(sourceId)) return current;
      const next = new Map(current);
      next.delete(sourceId);
      return next;
    });
  };
  const changeReview = (sourceId: string, update: Partial<IssueReview>): void => {
    setEntries((current) => {
      const entry = current.get(sourceId);
      if (!entry) return current;
      const next = new Map(current);
      next.set(sourceId, { ...entry, review: { ...entry.review, ...update } });
      return next;
    });
  };
  const replaceItem = (item: SourceIssue): void => {
    setEntries((current) => {
      const entry = current.get(item.sourceId);
      if (!entry) return current;
      const next = new Map(current);
      next.set(item.sourceId, { ...entry, item });
      return next;
    });
  };
  return { selected, reviews, toggleItem, removeItem, changeReview, replaceItem };
}

export function useIssueImportSubmission({
  selectedItems,
  reviews,
  repoPath,
  providerId,
  providerScope,
  onImported,
  onComplete,
  onRefreshed,
}: {
  selectedItems: SourceIssue[];
  reviews: Map<string, IssueReview>;
  repoPath: string;
  providerId: string;
  providerScope: NonNullable<RepositoryGitProviderContext>["config"];
  onImported: () => void;
  onComplete: (createdCount: number) => void;
  onRefreshed: (item: SourceIssue) => void;
}) {
  const queryClient = useQueryClient();
  const [outcomes, setOutcomes] = useState<Map<string, ImportOutcome>>(() => new Map());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const clearOutcome = (sourceId: string): void => {
    setOutcomes((current) => {
      const next = new Map(current);
      next.delete(sourceId);
      return next;
    });
    setSubmitError(null);
  };
  const pendingItems = selectedItems.filter(
    (item) => !item.linkedTaskId && outcomes.get(item.sourceId)?.outcome !== "created",
  );
  const importItems = async (): Promise<void> => {
    setIsSubmitting(true);
    setSubmitError(null);
    let completedCount = 0;
    try {
      const result = await host.issueItemsImport({
        repoPath,
        items: pendingItems.map((item) => {
          const review = reviews.get(item.sourceId) ?? initialReview(item);
          return {
            sourceId: item.sourceId,
            revision: item.revision,
            issueType: review.issueType,
            priority: review.priority,
            labels: review.labels.map((label) => label.trim()).filter(Boolean),
          };
        }),
      });
      const nextOutcomes = new Map([
        ...outcomes,
        ...result.results.map((outcome) => [outcome.sourceId, outcome] as const),
      ]);
      setOutcomes(nextOutcomes);
      if (result.results.some((item) => item.outcome === "created")) {
        onImported();
        void invalidateRepoIssueItemsQueries(queryClient, repoPath);
      }
      if (
        selectedItems.length > 0 &&
        selectedItems.every(
          (item) => item.linkedTaskId || nextOutcomes.get(item.sourceId)?.outcome === "created",
        )
      ) {
        completedCount = selectedItems.filter(
          (item) => nextOutcomes.get(item.sourceId)?.outcome === "created",
        ).length;
      }
    } catch (cause) {
      setSubmitError(errorMessage(cause));
    } finally {
      setIsSubmitting(false);
    }
    if (completedCount > 0) onComplete(completedCount);
  };
  const refreshItem = async (sourceId: string): Promise<void> => {
    setRefreshingId(sourceId);
    try {
      const item = await queryClient.fetchQuery({
        queryKey: ["issue-item", providerId, repoPath, providerScope, sourceId],
        queryFn: () => host.issueItemGet({ repoPath, sourceId }),
        staleTime: 0,
      });
      onRefreshed(item);
      setOutcomes((current) => {
        const next = new Map(current);
        if (item.linkedTaskId) {
          next.set(sourceId, {
            sourceId,
            outcome: "failed",
            taskId: item.linkedTaskId,
            reason: `This source item is already linked to Task ${item.linkedTaskId}.`,
          });
        } else {
          next.delete(sourceId);
        }
        return next;
      });
    } catch (cause) {
      setOutcomes((current) =>
        new Map(current).set(sourceId, {
          sourceId,
          outcome: "failed",
          reason: errorMessage(cause),
        }),
      );
    } finally {
      setRefreshingId(null);
    }
  };
  return {
    outcomes,
    isSubmitting,
    refreshingId,
    submitError,
    pendingItems,
    importItems,
    refreshItem,
    clearOutcome,
  };
}
