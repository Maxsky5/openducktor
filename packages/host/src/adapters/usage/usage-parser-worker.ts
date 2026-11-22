import { type MessagePort, parentPort } from "node:worker_threads";
import { errorMessage } from "../../effect/host-errors";
import { parseUsageSource } from "./usage-source-parser";
import type { UsageParseReply, UsageParseRun } from "./usage-worker-protocol";

const port = parentPort;
if (!port) throw new Error("The usage parser must run in a worker thread.");

/**
 * Claims jobs of a run through the shared counter until none are left or the run is canceled.
 * The parsers claim jobs themselves, so they never wait for the index worker between jobs.
 */
const work = async (indexPort: MessagePort, run: UsageParseRun) => {
  const shared = new Int32Array(run.claims);
  while (Atomics.load(shared, 1) === 0) {
    const index = Atomics.add(shared, 0, 1);
    const job = run.jobs[index];
    if (!job) break;
    try {
      indexPort.postMessage({
        kind: "result",
        runId: run.runId,
        result: await parseUsageSource({ ...job, jobId: index }, (progress) =>
          indexPort.postMessage({
            kind: "progress",
            runId: run.runId,
            jobId: index,
            progress,
          } satisfies UsageParseReply),
        ),
      } satisfies UsageParseReply);
    } catch (cause) {
      // The run stops at once: no parser claims a job after a fault.
      Atomics.store(shared, 1, 1);
      indexPort.postMessage({
        kind: "failed",
        runId: run.runId,
        message: `The ${job.runtime} usage parser failed: ${errorMessage(cause)}`,
      } satisfies UsageParseReply);
    }
  }
  indexPort.postMessage({ kind: "idle", runId: run.runId } satisfies UsageParseReply);
};

// The host sends the port to the index worker first. Runs and results use that port only.
port.once("message", ({ indexPort }: { indexPort: MessagePort }) => {
  let queue = Promise.resolve();
  indexPort.on("message", (run: UsageParseRun) => {
    queue = queue.then(() => work(indexPort, run));
  });
});
