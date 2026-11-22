import { Cause, Effect, Exit } from "effect";
import { errorMessage } from "../../effect/host-errors";
import { usagePreparingProgress } from "./usage-index-progress";
import type { UsageIndexReader } from "./usage-index-read";
import type { createUsageRateCatalog } from "./usage-rate-catalog";
import type { UsageIndexReadInput, UsageIndexReply } from "./usage-worker-protocol";

/**
 * The requests of the index worker. Reads run one at a time, in arrival order. After a read that
 * skipped history, a catch-up parses that history in the background until a new read arrives.
 */
export const createUsageIndexQueue = ({
  index,
  rates,
  reply,
}: {
  index: Pick<
    UsageIndexReader,
    "isFirstRead" | "stopParsing" | "needsCatchUp" | "read" | "catchUp"
  >;
  rates: Pick<ReturnType<typeof createUsageRateCatalog>, "current">;
  reply: (message: UsageIndexReply) => void;
}) => {
  let activeRequestId: number | null = null;
  const cancelled = new Set<number>();
  let queue: Promise<void> = Promise.resolve();
  /** Reads that wait in the queue. A waiting read stops the catch-up. */
  let waiting = 0;
  /** The input of the last read that skipped history, until the catch-up parses it. */
  let catchUp: UsageIndexReadInput | null = null;
  let catchingUp = false;

  /** Tells the adapter when the worker has nothing to do, so its idle stop never cuts work. */
  const settle = () => {
    if (waiting === 0 && catchUp === null && !catchingUp) reply({ kind: "idle" });
  };

  /**
   * Parses the history that the last read skipped, in the background, so the next range or
   * runtime reads fast. A new read stops it, and it resumes after that read.
   */
  const runCatchUp = () => {
    queue = queue.then(async () => {
      const input = catchUp;
      if (!input || waiting > 0) return;
      catchUp = null;
      catchingUp = true;
      const exit = await Effect.runPromiseExit(
        rates
          .current()
          .pipe(
            Effect.flatMap((pricing) =>
              index.catchUp({ input, pricing, isStopped: () => waiting > 0 }),
            ),
          ),
      );
      catchingUp = false;
      // A read that the catch-up needs will meet the same failure and report it.
      if (Exit.isFailure(exit))
        console.error("Usage history catch-up failed", Cause.squash(exit.cause));
      else if (waiting > 0) catchUp = input;
      settle();
    });
  };

  const runRead = async (requestId: number, input: UsageIndexReadInput) => {
    const isCancelled = () => cancelled.has(requestId);
    if (isCancelled()) {
      reply({ kind: "cancelled", requestId });
      return;
    }
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const first = yield* index.isFirstRead();
        // A first read can take a minute. Clients show it at once, before the rates and the
        // history search.
        if (first) reply({ kind: "progress", requestId, progress: usagePreparingProgress() });
        const pricing = yield* rates.current();
        return yield* index.read({
          input,
          pricing,
          first,
          isCancelled,
          onProgress: (progress) => reply({ kind: "progress", requestId, progress }),
        });
      }),
    );
    // The index and the parsers give their failures the message for the user.
    if (Exit.isFailure(exit)) {
      reply({ kind: "error", requestId, message: errorMessage(Cause.squash(exit.cause)) });
      return;
    }
    // A canceled read commits what it finished, but its caller no longer waits for it.
    reply(
      isCancelled()
        ? { kind: "cancelled", requestId }
        : { kind: "result", requestId, result: exit.value },
    );
    if (index.needsCatchUp(input)) catchUp = input;
  };

  return {
    read: (requestId: number, input: UsageIndexReadInput) => {
      waiting++;
      // A read goes first: the catch-up stops claiming parse jobs.
      if (catchingUp) index.stopParsing();
      queue = queue.then(async () => {
        waiting--;
        activeRequestId = requestId;
        try {
          await runRead(requestId, input);
        } catch (cause) {
          reply({ kind: "error", requestId, message: errorMessage(cause) });
        } finally {
          activeRequestId = null;
          cancelled.delete(requestId);
          if (catchUp !== null) runCatchUp();
          else settle();
        }
      });
    },

    cancel: (requestId: number) => {
      cancelled.add(requestId);
      if (requestId === activeRequestId) index.stopParsing();
    },
  };
};
