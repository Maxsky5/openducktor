import { parentPort } from "node:worker_threads";
import { knownRuntimeKindValues } from "@openducktor/contracts";
import { Cause, Effect, Exit } from "effect";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
import {
  catchUpUsageIndex,
  createUsageCheckMemo,
  readUsageIndex,
  type UsageReadContext,
} from "./usage-index-read";
import { createUsageRepositoryResolver } from "./usage-repositories";
import { createUsageIndexStore } from "./usage-index-store";
import { createUsageParsePool } from "./usage-parse-pool";
import { createUsageRateCatalog } from "./usage-rate-catalog";
import type { UsageReadInput } from "../../ports/usage-index-port";
import type { UsageIndexReply, UsageIndexRequest } from "./usage-worker-protocol";

const port = parentPort;
if (!port) throw new Error("The usage index must run in a worker thread.");

/** Index storage failures name the index and the action that fixes them. */
const failureMessage = (cause: unknown): string => {
  const message = errorMessage(cause);
  if (!(cause instanceof HostOperationError) || cause.operation === "usage.index.open")
    return message;
  return `OpenDucktor cannot update its usage index: ${message} Check the free disk space and access to the OpenDucktor config folder, then retry.`;
};

let index: { context: UsageReadContext; rates: ReturnType<typeof createUsageRateCatalog> } | null =
  null;
let activeRequestId: number | null = null;
const cancelled = new Set<number>();
let queue: Promise<void> = Promise.resolve();
/** Reads that wait in the queue. A waiting read stops the catch-up. */
let waiting = 0;
/** The input of the last read that skipped history, until the catch-up parses it. */
let catchUp: UsageReadInput | null = null;
let catchingUp = false;

const reply = (message: UsageIndexReply) => port.postMessage(message);

/** Tells the adapter when the worker has nothing to do, so its idle stop never cuts work. */
const settle = () => {
  if (waiting === 0 && catchUp === null && !catchingUp) reply({ kind: "idle" });
};

/**
 * Parses the history that the last read skipped, in the background, so the next range or runtime
 * reads fast. A new read stops it, and it resumes after that read.
 */
const runCatchUp = () => {
  queue = queue.then(async () => {
    const input = catchUp;
    if (!index || !input || waiting > 0) return;
    catchUp = null;
    catchingUp = true;
    const { context, rates } = index;
    const exit = await Effect.runPromiseExit(
      rates
        .current()
        .pipe(
          Effect.flatMap((pricing) =>
            catchUpUsageIndex(context, input, pricing, () => waiting > 0),
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

port.on("message", (message: UsageIndexRequest) => {
  if (message.kind === "init") {
    const store = createUsageIndexStore(message.indexPath);
    index = {
      context: {
        store,
        pool: createUsageParsePool(message.parserPorts),
        repositories: createUsageRepositoryResolver(),
        checks: createUsageCheckMemo(),
      },
      rates: createUsageRateCatalog(store.rates, message.ratesUrl),
    };
    return;
  }
  if (message.kind === "cancel") {
    cancelled.add(message.requestId);
    if (message.requestId === activeRequestId) index?.context.pool.stop();
    return;
  }
  const { requestId } = message;
  waiting++;
  // A read goes first: the catch-up stops claiming parse jobs.
  if (catchingUp) index?.context.pool.stop();
  // One request at a time, in arrival order.
  queue = queue.then(async () => {
    waiting--;
    const isCancelled = () => cancelled.has(requestId);
    activeRequestId = requestId;
    try {
      if (!index) throw new Error("The usage index received a read before its setup.");
      if (isCancelled()) {
        reply({ kind: "cancelled", requestId });
        return;
      }
      const { context, rates } = index;
      // A first read can take a minute. Clients show it at once, before the rates and the
      // history search; a failure here comes back from the read itself.
      const empty = await Effect.runPromiseExit(context.store.isEmpty());
      if (Exit.isSuccess(empty) && empty.value)
        reply({
          kind: "progress",
          requestId,
          progress: {
            phase: "preparing",
            first: true,
            summarized: 0,
            startedAt: new Date().toISOString(),
            runtimes: [],
          },
        });
      const exit = await Effect.runPromiseExit(
        rates
          .current()
          .pipe(
            Effect.flatMap((pricing) =>
              readUsageIndex(context, message.input, pricing, isCancelled, (progress) =>
                reply({ kind: "progress", requestId, progress }),
              ),
            ),
          ),
      );
      if (Exit.isFailure(exit)) {
        reply({ kind: "error", requestId, message: failureMessage(Cause.squash(exit.cause)) });
        return;
      }
      // A canceled read commits what it finished, but its caller no longer waits for it.
      reply(
        isCancelled()
          ? { kind: "cancelled", requestId }
          : { kind: "result", requestId, result: exit.value },
      );
      // A read of a range or of one runtime skips the rest of the history, until the index holds
      // all of it: an older source that changes gets a recent modification time.
      if (
        !context.checks.complete() &&
        (message.input.range.start !== null ||
          message.input.runtimes.length < knownRuntimeKindValues.length)
      )
        catchUp = message.input;
    } catch (cause) {
      reply({ kind: "error", requestId, message: failureMessage(cause) });
    } finally {
      activeRequestId = null;
      cancelled.delete(requestId);
      if (catchUp !== null) runCatchUp();
      else settle();
    }
  });
});
