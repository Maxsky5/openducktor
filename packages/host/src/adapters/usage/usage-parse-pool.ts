import type { MessagePort } from "node:worker_threads";
import { Data, Effect, Queue } from "effect";
import type {
  OpenCodeProgress,
  UsageParseJob,
  UsageParseReply,
  UsageParseResult,
  UsageParseRun,
} from "./usage-worker-protocol";

/** A parser thread failed on a source. Its message names the cause. */
export class UsageParserFault extends Data.TaggedError("UsageParserFault")<{
  readonly message: string;
}> {}

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
     * a failed commit stops the run: later results do not commit, and the run fails with the
     * first failure after every parser stopped.
     */
    run: <E>({
      jobs,
      commit,
      isCancelled,
      onProgress = () => {},
    }: {
      jobs: readonly UsageParseJob[];
      /** Commits the result of the job at `jobIndex` in `jobs`. */
      commit: (
        jobIndex: number,
        job: UsageParseJob,
        result: UsageParseResult,
      ) => Effect.Effect<void, E>;
      isCancelled: () => boolean;
      /** Gets the progress inside a database source, by its index in `jobs`. */
      onProgress?: (jobIndex: number, progress: OpenCodeProgress) => void;
    }): Effect.Effect<void, E | UsageParserFault> =>
      Effect.gen(function* () {
        if (jobs.length === 0) return;
        const runId = nextRunId++;
        const claims = new SharedArrayBuffer(8);
        const shared = new Int32Array(claims);
        const stop = () => Atomics.store(shared, 1, 1);
        const replies = yield* Queue.unbounded<UsageParseReply>();
        const onReply = (reply: UsageParseReply) => {
          if (reply.runId === runId) Queue.offerUnsafe(replies, reply);
        };
        let failure: E | UsageParserFault | null = null;
        const fail = (cause: E | UsageParserFault) =>
          Effect.sync(() => {
            failure ??= cause;
            stop();
          });

        const drain = Effect.gen(function* () {
          let idle = 0;
          while (idle < parsers.length) {
            const reply = yield* Queue.take(replies);
            if (reply.kind === "idle") idle++;
            else if (reply.kind === "progress") onProgress(reply.jobId, reply.progress);
            else if (reply.kind === "failed")
              yield* fail(new UsageParserFault({ message: reply.message }));
            else if (failure === null) {
              const job = jobs[reply.jobId];
              yield* job
                ? commit(reply.jobId, job, reply.result).pipe(Effect.catch(fail))
                : fail(
                    new UsageParserFault({ message: "A usage parser returned an unknown job." }),
                  );
            }
          }
          if (failure !== null) return yield* Effect.fail(failure);
        });

        yield* Effect.acquireUseRelease(
          Effect.sync(() => {
            stopActive = () => {
              if (isCancelled()) stop();
            };
            if (isCancelled()) stop();
            for (const parser of parsers) {
              parser.on("message", onReply);
              parser.postMessage({ runId, jobs, claims } satisfies UsageParseRun);
            }
          }),
          () => drain,
          () =>
            Effect.sync(() => {
              // A run that ends early, such as on a defect of a commit, claims no more jobs.
              stop();
              stopActive = null;
              for (const parser of parsers) parser.off("message", onReply);
            }),
        );
      }),
  };
};
