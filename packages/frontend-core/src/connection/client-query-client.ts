import { onlineManager, QueryClient } from "@tanstack/react-query";
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
 * A local host connection is the online state of these reads (see `followHostConnection`), so a
 * read that loses the host waits for the reconnect instead of failing. A command fails at once, so it
 * cannot run later when the user does not expect it.
 */
export const createClientQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: retryLostConnection,
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
