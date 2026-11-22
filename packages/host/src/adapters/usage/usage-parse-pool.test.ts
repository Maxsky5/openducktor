import { afterEach, describe, expect, test } from "bun:test";
import { MessageChannel, type MessagePort } from "node:worker_threads";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { createUsageParsePool, UsageParserFault } from "./usage-parse-pool";
import type { UsageParseJob, UsageParseReply, UsageParseRun } from "./usage-worker-protocol";

const ports: MessagePort[] = [];
afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

const job = (path: string): UsageParseJob => ({
  runtime: "claude",
  path,
  format: "jsonl",
  fingerprint: { size: 1, modifiedAtMs: 1, fileId: "1:1" },
  previous: null,
});

/** A parser thread that claims jobs as the real one does, and fails on a path named `fault`. */
const fakeParser = (): MessagePort => {
  const { port1, port2 } = new MessageChannel();
  ports.push(port1, port2);
  port2.on("message", (run: UsageParseRun) => {
    const shared = new Int32Array(run.claims);
    const send = (reply: UsageParseReply) => port2.postMessage(reply);
    while (Atomics.load(shared, 1) === 0) {
      const index = Atomics.add(shared, 0, 1);
      const claimed = run.jobs[index];
      if (!claimed) break;
      if (claimed.path === "fault") {
        Atomics.store(shared, 1, 1);
        send({ kind: "failed", runId: run.runId, message: "The claude usage parser failed." });
        continue;
      }
      send({
        kind: "result",
        runId: run.runId,
        jobId: index,
        result: { mode: "replace", units: [], resume: null, parserState: null, issue: null },
      });
    }
    send({ kind: "idle", runId: run.runId });
  });
  return port1;
};

describe("createUsageParsePool", () => {
  test("commits each result of every parser", async () => {
    const pool = createUsageParsePool([fakeParser(), fakeParser()]);
    const committed: string[] = [];
    await Effect.runPromise(
      pool.run({
        jobs: ["a", "b", "c"].map(job),
        commit: (jobIndex, parsed) =>
          Effect.sync(() => void committed.push(`${jobIndex}:${parsed.path}`)),
        isCancelled: () => false,
      }),
    );
    expect(committed.toSorted()).toEqual(["0:a", "1:b", "2:c"]);
  });

  test("fails with the fault of a parser, and with the first failed commit", async () => {
    const pool = createUsageParsePool([fakeParser()]);
    const fault = await Effect.runPromise(
      pool
        .run({ jobs: [job("fault")], commit: () => Effect.void, isCancelled: () => false })
        .pipe(Effect.flip),
    );
    expect(fault).toBeInstanceOf(UsageParserFault);
    expect(fault.message).toBe("The claude usage parser failed.");
    const committed: number[] = [];
    const failed = await Effect.runPromise(
      pool
        .run({
          jobs: ["a", "b"].map(job),
          commit: (jobIndex) =>
            Effect.sync(() => committed.push(jobIndex)).pipe(
              Effect.andThen(
                Effect.fail(new HostOperationError({ operation: "test", message: "Disk full." })),
              ),
            ),
          isCancelled: () => false,
        })
        .pipe(Effect.flip),
    );
    expect(failed).not.toBeInstanceOf(UsageParserFault);
    expect(failed.message).toBe("Disk full.");
    // Later results of the run do not commit.
    expect(committed).toEqual([0]);
  });

  test("claims no job of a canceled run", async () => {
    const pool = createUsageParsePool([fakeParser()]);
    const committed: number[] = [];
    await Effect.runPromise(
      pool.run({
        jobs: ["a", "b"].map(job),
        commit: (jobIndex) => Effect.sync(() => void committed.push(jobIndex)),
        isCancelled: () => true,
      }),
    );
    expect(committed).toEqual([]);
  });
});
