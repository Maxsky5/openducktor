import type { AgentSessionLiveRef } from "@openducktor/contracts";
import { Effect } from "effect";
import { type HostError, toHostOperationError } from "../../effect/host-errors";
import { createRetryableCleanup } from "../../effect/retryable-cleanup";

/**
 * Closes the adapter on the first call. Native cleanup stays unfinished until it succeeds, so a
 * later call retries it. A completed release returns the refs of the close.
 */
export const createOpenCodeAdapterRelease = ({
  runtimeId,
  close,
  releaseNative,
}: {
  runtimeId: string;
  close: () => ReadonlyArray<AgentSessionLiveRef>;
  releaseNative: () => Promise<void>;
}): Effect.Effect<ReadonlyArray<AgentSessionLiveRef>, HostError> => {
  let closedRefs: ReadonlyArray<AgentSessionLiveRef> | null = null;
  const release = createRetryableCleanup(
    Effect.tryPromise({
      try: releaseNative,
      catch: (cause) =>
        toHostOperationError(cause, "opencode-live-session.release-runtime", { runtimeId }),
    }).pipe(Effect.map(() => closedRefs ?? [])),
  );
  return Effect.suspend(() => {
    closedRefs ??= close();
    return release;
  });
};
