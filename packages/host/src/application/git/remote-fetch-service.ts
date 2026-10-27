import { Clock, type Duration, Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { createKeyedSharedFlight } from "../../effect/shared-flight";
import type { GitPort, GitPortError } from "../../ports/git-port";

/** A fetch of the last 5 minutes is current enough for a fetch that nobody asked for. */
const FRESH_FOR_MS = 5 * 60 * 1000;

/** A fetch that runs longer fails, so a remote that does not answer cannot block its callers. */
const FETCH_TIMEOUT: Duration.Input = "60 seconds";

export type RemoteFetchError = GitPortError | HostOperationError;

export type RemoteFetchResult = { outcome: "fetched"; output: string } | { outcome: "fresh" };

/**
 * The one way the host fetches a remote. The Git panel and merge detection share it, so they do
 * not fetch the same remote twice. Every fetch updates all branches of the remote.
 */
export type RemoteFetchService = {
  /**
   * Fetches every branch of one remote of a repository. A call while a fetch of that remote runs
   * waits for it. Without `force`, a remote that a fetch of the last 5 minutes updated is fresh and
   * no fetch runs. A manual Refresh and Check again use `force`.
   */
  fetch(input: {
    repoPath: string;
    remote: string;
    force: boolean;
  }): Effect.Effect<RemoteFetchResult, RemoteFetchError>;
};

export const createRemoteFetchService = (
  gitPort: Pick<GitPort, "fetchRemote">,
): RemoteFetchService => {
  // The remote branches of a repository are the same for each of its worktrees.
  const fetchedAt = new Map<string, number>();
  const flights = createKeyedSharedFlight<string, string, RemoteFetchError>();

  const runFetch = (key: string, repoPath: string, remote: string) =>
    gitPort.fetchRemote(repoPath, remote).pipe(
      Effect.timeoutOrElse({
        duration: FETCH_TIMEOUT,
        orElse: () =>
          Effect.fail(
            new HostOperationError({
              operation: "git.fetch",
              message: `git fetch ${remote} did not finish in time.`,
              details: { repoPath, remote },
            }),
          ),
      }),
      Effect.tap(() => Clock.currentTimeMillis.pipe(Effect.map((now) => fetchedAt.set(key, now)))),
    );

  return {
    fetch: ({ repoPath, remote, force }) =>
      Effect.gen(function* () {
        const key = `${repoPath}\u0000${remote}`;
        const lastFetch = fetchedAt.get(key);
        const now = yield* Clock.currentTimeMillis;
        if (!force && lastFetch !== undefined && now - lastFetch < FRESH_FOR_MS) {
          return { outcome: "fresh" } as const;
        }
        const output = yield* flights.run(key, runFetch(key, repoPath, remote));
        return { outcome: "fetched", output } as const;
      }),
  };
};
