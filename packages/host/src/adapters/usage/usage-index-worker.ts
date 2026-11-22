import { parentPort } from "node:worker_threads";
import { createUsageIndexQueue } from "./usage-index-queue";
import { createUsageIndexReader } from "./usage-index-read";
import { createUsageIndexStore } from "./usage-index-store";
import { createUsageParsePool } from "./usage-parse-pool";
import { createUsageRateCatalog } from "./usage-rate-catalog";
import type { UsageIndexReply, UsageIndexRequest } from "./usage-worker-protocol";

const port = parentPort;
if (!port) throw new Error("The usage index must run in a worker thread.");

const reply = (message: UsageIndexReply) => port.postMessage(message);

let queue: ReturnType<typeof createUsageIndexQueue> | null = null;

port.on("message", (message: UsageIndexRequest) => {
  if (message.kind === "init") {
    const store = createUsageIndexStore(message.indexPath);
    queue = createUsageIndexQueue({
      index: createUsageIndexReader({ store, pool: createUsageParsePool(message.parserPorts) }),
      rates: createUsageRateCatalog(store.rates, message.ratesUrl),
      reply,
    });
    return;
  }
  // The adapter sends `init` first on the same port, so a request always finds the queue.
  if (!queue) throw new Error("The usage index received a request before its setup.");
  if (message.kind === "cancel") queue.cancel(message.requestId);
  else queue.read(message.requestId, message.input);
});
