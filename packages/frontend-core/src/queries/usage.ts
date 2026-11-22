import type { UsageReportReadInput } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { connectionHost } from "../connection/client-connection";

/**
 * The usage report of one selection. It stays until Refresh, which reads it again. A newer
 * selection cancels the read of the one before it on the host.
 */
const USAGE_REPORT_KEY = "usage-report";

export const usageReportQueryOptions = (input: UsageReportReadInput) =>
  queryOptions({
    queryKey: [USAGE_REPORT_KEY, input.range, input.runtime],
    // A read of a selection that has a result is a refresh: it checks the history again. A new
    // selection can use a recent check of the host and answers from its index at once.
    queryFn: ({ client, queryKey, signal }) =>
      connectionHost(client).usageReportRead(
        { ...input, refresh: client.getQueryData(queryKey) !== undefined },
        signal,
      ),
    staleTime: Infinity,
    // A cold read can take a minute, so reconnect recovery must not wait for it. The connection
    // reads it again after admission with `refreshUsageReports`.
    meta: { skipHostRecovery: true },
  });

/**
 * Drops every Usage result when access to the host ends or another host instance answers. An
 * open page shows loading, and its read waits for the next connection.
 */
export const clearUsageReports = (queryClient: QueryClient): Promise<void> =>
  queryClient.resetQueries({ queryKey: [USAGE_REPORT_KEY] });

/** Reads the open Usage report again after a reconnect, without holding up the connection. */
export const refreshUsageReports = (queryClient: QueryClient): void => {
  void queryClient
    .refetchQueries({ queryKey: [USAGE_REPORT_KEY], type: "active" })
    .catch(() => undefined);
};
