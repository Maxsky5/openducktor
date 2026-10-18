import { errorMessage } from "@openducktor/frontend-core/lib/errors";

export type HistoryFooter =
  | { kind: "loading" }
  | { kind: "error"; message: string; retry: () => void }
  | { kind: "more"; load: () => void }
  | { kind: "paused" }
  | { kind: "end" };

export function historyFooter(history: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  isRefetchError: boolean;
  error: Error | null;
  loadNext: () => void;
}): HistoryFooter {
  if (history.isFetchingNextPage) return { kind: "loading" };
  if (history.isFetchNextPageError) {
    return { kind: "error", message: errorMessage(history.error), retry: history.loadNext };
  }
  // A page of the old comparison would clear the refresh failure, so older rows wait for Refresh.
  if (history.hasNextPage && history.isRefetchError) return { kind: "paused" };
  if (history.hasNextPage) return { kind: "more", load: history.loadNext };
  return { kind: "end" };
}
