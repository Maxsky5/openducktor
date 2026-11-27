import { HostUnreachableError } from "@openducktor/host-client";
import {
  type DefaultError,
  type FetchQueryOptions,
  onlineManager,
  QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { isConnectionFailure } from "../lib/command-outcome";

const MINUTE_MS = 60_000;

/**
 * A read that lost the host connection runs again after the reconnect. The transport reports the
 * lost connection before the read fails, so a connection failure while still online, such as a
 * protocol mismatch, fails as usual.
 */
const retryLostConnection = (_failureCount: number, cause: Error): boolean =>
  isConnectionFailure(cause) && !onlineManager.isOnline();

/**
 * A view read waits for the reconnect. A read that code awaits, such as the check before a
 * command, fails at once instead, so the command never runs after the reconnect. The shared fetch
 * keeps waiting for the views, and the cache gets no error.
 */
class ClientQueryClient extends QueryClient {
  override fetchQuery<
    TQueryFnData,
    TError = DefaultError,
    TData = TQueryFnData,
    TQueryKey extends QueryKey = QueryKey,
    TPageParam = never,
  >(
    options: FetchQueryOptions<TQueryFnData, TError, TData, TQueryKey, TPageParam>,
  ): Promise<TData> {
    const read = super.fetchQuery(options);
    const query = this.getQueryCache().build(this, this.defaultQueryOptions(options));
    return new Promise<TData>((resolve, reject) => {
      let settled = false;
      const settle = (finish: () => void) => {
        if (settled) return;
        settled = true;
        stop();
        finish();
      };
      const failWhenPaused = () => {
        if (query.state.fetchStatus !== "paused") return;
        const lost = new HostUnreachableError(new Error("The host connection is lost."));
        settle(() => reject(lost));
      };
      const stop = this.getQueryCache().subscribe(({ query: changed }) => {
        if (changed === query) failWhenPaused();
      });
      read.then(
        (data) => settle(() => resolve(data)),
        (cause: unknown) => settle(() => reject(cause)),
      );
      // Cached data answers first, also while an earlier fetch of the query waits.
      queueMicrotask(failWhenPaused);
    });
  }
}

/**
 * A local host connection is the online state of these reads (see `followHostConnection`). A
 * command fails at once, so it cannot run later when the user does not expect it.
 */
export const createClientQueryClient = (): QueryClient =>
  new ClientQueryClient({
    defaultOptions: {
      queries: {
        retry: retryLostConnection,
        // A retry only waits for the reconnect.
        retryDelay: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        staleTime: MINUTE_MS,
        gcTime: 10 * MINUTE_MS,
      },
      mutations: {
        networkMode: "always",
        retry: false,
      },
    },
  });
