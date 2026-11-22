import type { UsageReport, UsageReportReadInput } from "@openducktor/contracts";
import { describeRemoteConnectionFailure } from "@openducktor/frontend-core/lib/remote-connection-failure";
import { usageReportQueryOptions } from "@openducktor/frontend-core/queries/usage";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type UsageProgressState, useUsageProgress } from "./use-usage-progress";

/** What the page shows of the report of one selection. */
export type UsageReportState = {
  /** The result of the selection. A failed read of a new selection has none. */
  report: UsageReport | undefined;
  error: Error | null;
  /** True while a new selection loads and the page keeps the result of the one before it. */
  loadingSelection: boolean;
  fetching: boolean;
  /** True when the host does not know the Usage command. */
  unavailable: boolean;
  /** The parse progress of the host while a read parses new history. */
  progress: UsageProgressState | null;
  refetch: () => void;
};

/**
 * The report of a selection. A new selection keeps the shown result, marked as loading, until its
 * own result arrives, so the page never falls back to the skeleton between two results.
 */
export const useUsageReport = (selection: UsageReportReadInput): UsageReportState => {
  const query = useQuery({
    ...usageReportQueryOptions(selection),
    placeholderData: keepPreviousData,
  });
  const progress = useUsageProgress(query.isFetching);
  const { error } = query;
  return {
    // A failed read of a new selection shows its error, not the result of another selection.
    report: query.isPlaceholderData && !query.isFetching ? undefined : query.data,
    error,
    loadingSelection: query.isPlaceholderData && query.isFetching,
    fetching: query.isFetching,
    // A host without Usage refuses the command that it does not know.
    unavailable:
      error !== null && describeRemoteConnectionFailure(error).code === "function_unavailable",
    progress,
    refetch: () => void query.refetch(),
  };
};
