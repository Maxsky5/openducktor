import { availableParallelism } from "node:os";
import { MessageChannel, type MessagePort, Worker } from "node:worker_threads";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { siblingWorkerUrl } from "../../infrastructure/sibling-worker-url";
import type { UsageIndexPort, UsageReadResult } from "../../ports/usage-index-port";
import { USAGE_RATES_URL } from "./usage-rate-catalog";
import type { UsageIndexProgress } from "@openducktor/contracts";
import type { UsageIndexReply, UsageIndexRequest } from "./usage-worker-protocol";

const indexWorkerUrl = siblingWorkerUrl(import.meta.url, "usage-index-worker");
const parserWorkerUrl = siblingWorkerUrl(import.meta.url, "usage-parser-worker");

/** Up to 4 parsers, and at most half of the cores, so running sessions keep the rest. */
const PARSER_COUNT = Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)));

/** The threads stop together after this time without a request. */
const IDLE_MS = 60_000;

type Threads = { index: Worker; parsers: Worker[] };
type Pending = {
  resolve: (result: UsageReadResult) => void;
  reject: (error: HostOperationError) => void;
};

const threadFailure = (cause: unknown) =>
  new HostOperationError({
    operation: "usage.index.worker",
    message: "The usage reader stopped. Select Retry.",
    cause,
  });

/**
 * Runs the usage index on worker threads. The threads start with the first read and stop
 * together a minute after the worker reports that it is idle.
 */
export const createUsageIndexAdapter = ({
  indexPath,
  onProgress,
  ratesUrl = USAGE_RATES_URL,
}: {
  indexPath: string;
  /** Gets the parse progress of each read that reads new history. */
  onProgress: (progress: UsageIndexProgress) => void;
  /** The rate catalog to download. Tests serve their own. */
  ratesUrl?: string;
}): UsageIndexPort => {
  let threads: Threads | null = null;
  let nextRequestId = 1;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const pending = new Map<number, Pending>();

  const stop = () => {
    const current = threads;
    threads = null;
    // A stopped worker answers nothing, so the reads in flight fail now.
    const stopped = threadFailure(new Error("The usage reader stopped."));
    for (const request of pending.values()) request.reject(stopped);
    pending.clear();
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    if (!current) return Promise.resolve();
    return Promise.allSettled([
      current.index.terminate(),
      ...current.parsers.map((parser) => parser.terminate()),
    ]).then(() => undefined);
  };

  const failAll = (cause: unknown) => {
    const error = threadFailure(cause);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    void stop();
  };

  const start = (): Threads => {
    const parsers: Worker[] = [];
    const ports: MessagePort[] = [];
    for (let index = 0; index < PARSER_COUNT; index++) {
      const parser = new Worker(parserWorkerUrl, { name: "openducktor-usage-parser" });
      const channel = new MessageChannel();
      parser.postMessage({ indexPort: channel.port2 }, [channel.port2]);
      parser.on("error", failAll);
      parsers.push(parser);
      ports.push(channel.port1);
    }
    const index = new Worker(indexWorkerUrl, { name: "openducktor-usage-index" });
    index.postMessage(
      { kind: "init", indexPath, ratesUrl, parserPorts: ports } satisfies UsageIndexRequest,
      ports,
    );
    index.on("error", failAll);
    index.on("exit", (code) => {
      if (threads?.index === index) failAll(new Error(`The usage index exited with code ${code}.`));
    });
    index.on("message", (reply: UsageIndexReply) => {
      // The worker says when its queue and its background catch-up are done.
      if (reply.kind === "idle") {
        if (pending.size === 0 && !idleTimer) {
          idleTimer = setTimeout(() => void stop(), IDLE_MS);
          idleTimer.unref?.();
        }
        return;
      }
      const request = pending.get(reply.requestId);
      if (reply.kind === "progress") {
        // A canceled read still parses its open sources, but nobody waits for its progress.
        if (request) onProgress(reply.progress);
        return;
      }
      pending.delete(reply.requestId);
      if (reply.kind === "result") request?.resolve(reply.result);
      else if (reply.kind === "error")
        request?.reject(
          new HostOperationError({ operation: "usage.index.read", message: reply.message }),
        );
    });
    return { index, parsers };
  };

  const read: UsageIndexPort["read"] = (input) =>
    Effect.callback<UsageReadResult, HostOperationError>((resume) => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
      let current: Threads;
      try {
        threads ??= start();
        current = threads;
      } catch (cause) {
        resume(Effect.fail(threadFailure(cause)));
        return;
      }
      const requestId = nextRequestId++;
      pending.set(requestId, {
        resolve: (result) => resume(Effect.succeed(result)),
        reject: (error) => resume(Effect.fail(error)),
      });
      current.index.postMessage({ kind: "read", requestId, input } satisfies UsageIndexRequest);
      // A canceled request stops dispatching new sources. Sources in progress still commit.
      return Effect.sync(() => {
        if (!pending.delete(requestId)) return;
        current.index.postMessage({ kind: "cancel", requestId } satisfies UsageIndexRequest);
      });
    });

  return {
    read,
    shutdown: () => Effect.promise(stop),
  };
};
