import type { MessagePort } from "node:worker_threads";
import type { OpenCodeProgress } from "./usage-opencode-reader";
import type {
  UsageParseJob,
  UsageParseReply,
  UsageParseResult,
  UsageParseRun,
} from "./usage-worker-protocol";

/** A parser thread failed on a source. Its message names the cause. */
class UsageParserFault extends Error {}

export type UsageParsePool = ReturnType<typeof createUsageParsePool>;

/**
 * Runs parse jobs on the parser threads. The parsers claim jobs from a shared counter, so they
 * never wait for a commit.
 */
export const createUsageParsePool = (parsers: readonly MessagePort[]) => {
  let nextRunId = 1;
  /** Stops the active run from claiming more jobs. */
  let stopActive: (() => void) | null = null;

  return {
    /**
     * Stops the active run from claiming more jobs when its `isCancelled` says so. Jobs in
     * progress still finish and commit.
     */
    stop: () => stopActive?.(),

    /**
     * Parses the jobs and commits each result in arrival order, one at a time. A parser fault or
     * a failed commit stops the run: later results do not commit, and the run rejects with that
     * failure.
     */
    run: async (
      jobs: readonly Omit<UsageParseJob, "jobId">[],
      commit: (job: Omit<UsageParseJob, "jobId">, result: UsageParseResult) => Promise<void>,
      isCancelled: () => boolean,
      /** Gets the progress inside a database source, by its index in `jobs`. */
      onProgress: (jobIndex: number, progress: OpenCodeProgress) => void = () => {},
    ): Promise<void> => {
      if (jobs.length === 0) return;
      const runId = nextRunId++;
      const claims = new SharedArrayBuffer(8);
      const shared = new Int32Array(claims);
      const stop = () => Atomics.store(shared, 1, 1);
      stopActive = () => {
        if (isCancelled()) stop();
      };
      if (isCancelled()) stop();
      let commits: Promise<void> = Promise.resolve();
      let failure: Error | null = null;
      const fail = (cause: Error) => {
        failure ??= cause;
        stop();
      };
      const onResult = (result: UsageParseResult) => {
        commits = commits.then(async () => {
          if (failure) return;
          const job = jobs[result.jobId];
          try {
            if (!job) throw new UsageParserFault("A usage parser returned an unknown job.");
            await commit(job, result);
          } catch (cause) {
            fail(cause instanceof Error ? cause : new Error(String(cause)));
          }
        });
      };
      try {
        await Promise.all(
          parsers.map(
            (parser) =>
              new Promise<void>((resolve) => {
                const onReply = (reply: UsageParseReply) => {
                  if (reply.runId !== runId) return;
                  if (reply.kind === "result") onResult(reply.result);
                  else if (reply.kind === "progress") onProgress(reply.jobId, reply.progress);
                  else if (reply.kind === "failed") fail(new UsageParserFault(reply.message));
                  else {
                    parser.off("message", onReply);
                    resolve();
                  }
                };
                parser.on("message", onReply);
                parser.postMessage({ runId, jobs, claims } satisfies UsageParseRun);
              }),
          ),
        );
      } finally {
        stopActive = null;
      }
      await commits;
      if (failure) throw failure;
    },
  };
};
