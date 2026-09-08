import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Worker } from "node:worker_threads";
import {
  codexImageGenerationPart,
  type CodexImageGenerationPreparation,
} from "@openducktor/adapters-codex-app-server";
import { Cause, Effect, Exit, Fiber, Option, Scheduler, TestClock, TestContext } from "effect";
import {
  createGeneratedImageWorkers,
  type GeneratedImageWorkers,
} from "./generated-image-worker-client";
import type { GeneratedImageWorkerMessage } from "./generated-image-worker-protocol";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=";
const image = (result = png): CodexImageGenerationPreparation => ({
  item: {
    type: "imageGeneration",
    id: "image",
    status: "completed",
    result,
    revisedPrompt: null,
    failure: null,
  },
  context: { turnId: "turn" },
});
let workers: GeneratedImageWorkers;
beforeEach(async () => {
  workers = await Effect.runPromise(createGeneratedImageWorkers(() => Effect.void));
});
afterEach(async () => {
  await Effect.runPromise(workers.shutdown);
});
const payload = (itemId = "image") =>
  workers.preparePayload(Effect.succeed({ kind: "inline", itemId, base64: png }), itemId);

const failureOf = <A, E>(exit: Exit.Exit<A, E>) => {
  if (!Exit.isFailure(exit)) throw new Error("Expected a worker failure");
  expect([...Cause.defects(exit.cause)]).toEqual([]);
  return [...Cause.failures(exit.cause)];
};

test("history chunks preserve revisions, Unicode boundaries, and native outcomes", async () => {
  const splitUnicode = `${"x".repeat(1024 * 1024 - 1)}😀end`;
  const images = [
    image(),
    image(splitUnicode),
    { ...image(), item: { ...image().item, savedPath: "/output.png" } },
    { ...image(), item: { ...image().item, status: "in_progress" } },
    image(""),
  ];
  const lengths: number[] = [];
  const original = Worker.prototype.postMessage;
  const post = spyOn(Worker.prototype, "postMessage").mockImplementation(function (
    this: Worker,
    ...args: Parameters<Worker["postMessage"]>
  ) {
    // SAFETY: The client sends the protocol envelope through this intercepted Worker method.
    const { request } = args[0] as GeneratedImageWorkerMessage;
    if (request.kind === "history-chunk") lengths.push(request.chunk.length);
    if (request.kind === "history-start") expect(request.image.item.result).toBe("");
    return original.apply(this, args);
  });
  try {
    expect(await workers.prepareHistory(images)).toEqual(
      images.map(({ item, context }) =>
        item.savedPath
          ? expect.objectContaining({
              ...codexImageGenerationPart(item, context),
              previewUnavailableReason: expect.stringContaining("readable"),
            })
          : codexImageGenerationPart(item, context),
      ),
    );
    expect(lengths.length).toBeGreaterThan(2);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(1024 * 1024);
  } finally {
    post.mockRestore();
  }
});

test("oversized inline output still gets history metadata without a full-payload message", async () => {
  const oversized = image("x".repeat(45 * 1024 * 1024));
  expect(await workers.prepareHistory([oversized])).toEqual([
    codexImageGenerationPart(oversized.item, oversized.context),
  ]);
});

test("success reuses one worker and inline responses do not copy base64 back", async () => {
  const seen: Worker[] = [];
  const replies: unknown[] = [];
  const original = Worker.prototype.postMessage;
  const post = spyOn(Worker.prototype, "postMessage").mockImplementation(function (
    this: Worker,
    ...args: Parameters<Worker["postMessage"]>
  ) {
    seen.push(this);
    this.once("message", (reply) => replies.push(reply));
    return original.apply(this, args);
  });
  try {
    expect((await Effect.runPromise(payload())).base64).toBe(png);
    expect((await Effect.runPromise(payload())).base64).toBe(png);
    expect(new Set(seen).size).toBe(1);
    expect(replies).toEqual([
      { id: 0, result: { kind: "inline", byteLength: 68 } },
      { id: 1, result: { kind: "inline", byteLength: 68 } },
    ]);
    await Effect.runPromise(workers.shutdown);
    expect(seen[0]!.threadId).toBe(-1);
  } finally {
    post.mockRestore();
  }
});

test("file buffers transfer ownership to the worker", async () => {
  const bytes = Buffer.alloc(Buffer.from(png, "base64").length);
  Buffer.from(png, "base64").copy(bytes);
  const result = await Effect.runPromise(
    workers.preparePayload(
      Effect.succeed({
        kind: "file",
        bytes,
        revision: createHash("sha256").update("saved_file\0").update(bytes).digest("hex"),
        itemId: "file",
      }),
      "file",
    ),
  );
  expect(result.base64).toBe(png);
  expect(bytes.buffer.byteLength).toBe(0);
});

for (const failure of [
  "error",
  "exit",
  "messageerror",
  "malformed",
  "wrong-kind",
  "wrong-id",
  "send",
] as const) {
  test(`${failure} preserves diagnostics, stops its worker, and permits later work`, async () => {
    const native = new Error("worker failure");
    const failed: Worker[] = [];
    const original = Worker.prototype.postMessage;
    const post = spyOn(Worker.prototype, "postMessage").mockImplementation(function (
      this: Worker,
      ...args: Parameters<Worker["postMessage"]>
    ) {
      // SAFETY: The client sends the protocol envelope through this intercepted Worker method.
      const { id, request } = args[0] as GeneratedImageWorkerMessage;
      if (request.kind !== "inline" || request.itemId !== "failure")
        return original.apply(this, args);
      failed.push(this);
      if (failure === "error" || failure === "messageerror") this.emit(failure, native);
      else if (failure === "exit") this.emit("exit", 7);
      else if (failure === "send") throw native;
      else if (failure === "malformed")
        this.emit("message", { id, result: { kind: "inline", byteLength: "invalid" } });
      else if (failure === "wrong-id")
        this.emit("message", { id: id + 1, result: { kind: "inline", byteLength: 68 } });
      else this.emit("message", { id, result: { kind: "ack" } });
    });
    try {
      const failures = failureOf(await Effect.runPromiseExit(payload("failure")));
      expect(failures).toMatchObject([
        {
          _tag: "HostOperationError",
          operation: "generated-image.read",
          details: { itemId: "failure" },
        },
      ]);
      if (["error", "messageerror", "send"].includes(failure))
        expect(failures[0]?.cause).toBe(native);
      if (failure === "exit") expect(failures[0]?.details).toMatchObject({ exitCode: 7 });
      expect(failed[0]!.threadId).toBe(-1);
      expect((await Effect.runPromise(payload())).base64).toBe(png);
    } finally {
      post.mockRestore();
    }
  });
}

test("admission bounds file allocations and cancels queued work before reading", async () => {
  const started = Promise.withResolvers<void>();
  const seen: Worker[] = [];
  let allocations = 0;
  const original = Worker.prototype.postMessage;
  const post = spyOn(Worker.prototype, "postMessage").mockImplementation(function (
    this: Worker,
    ...args: Parameters<Worker["postMessage"]>
  ) {
    // SAFETY: The client sends the protocol envelope through this intercepted Worker method.
    const { request } = args[0] as GeneratedImageWorkerMessage;
    if (request.kind !== "inline" || !request.itemId.startsWith("held"))
      return original.apply(this, args);
    seen.push(this);
    if (seen.length === 2) started.resolve();
  });
  const fibers = Array.from({ length: 8 }, (_, index) =>
    Effect.runFork(
      workers.preparePayload(
        Effect.sync(() => {
          allocations++;
          return { kind: "inline" as const, itemId: `held${index}`, base64: png };
        }),
        `held${index}`,
      ),
    ),
  );
  try {
    await started.promise;
    expect(allocations).toBe(2);
    const failures = failureOf(await Effect.runPromiseExit(payload("overflow")));
    expect(failures[0]?.details).toMatchObject({ phase: "capacity" });
    await Effect.runPromise(Fiber.interrupt(fibers[7]!));
    expect(allocations).toBe(2);
    await Promise.all(fibers.map((fiber) => Effect.runPromise(Fiber.interrupt(fiber))));
    expect(seen.every((worker) => worker.threadId === -1)).toBe(true);
    expect((await Effect.runPromise(payload())).base64).toBe(png);
  } finally {
    await Promise.all(fibers.map((fiber) => Effect.runPromise(Fiber.interrupt(fiber))));
    post.mockRestore();
  }
});

test("the Promise callback propagates abort and frees capacity", async () => {
  const started = Promise.withResolvers<Worker>();
  const original = Worker.prototype.postMessage;
  const post = spyOn(Worker.prototype, "postMessage").mockImplementation(function (
    this: Worker,
    ...args: Parameters<Worker["postMessage"]>
  ) {
    // SAFETY: The client sends the protocol envelope through this intercepted Worker method.
    const { request } = args[0] as GeneratedImageWorkerMessage;
    if (request.kind === "history-start") {
      started.resolve(this);
      return;
    }
    return original.apply(this, args);
  });
  const abort = new AbortController();
  const pending = workers.prepareHistory([image()], abort.signal);
  const settled = pending.then(
    () => undefined,
    (cause: unknown) => cause,
  );
  try {
    const worker = await started.promise;
    abort.abort();
    expect(await settled).toBeInstanceOf(Error);
    expect(worker.threadId).toBe(-1);
    expect((await Effect.runPromise(payload())).base64).toBe(png);
  } finally {
    abort.abort();
    await pending.catch(() => undefined);
    post.mockRestore();
  }
});

test("a deadline stops an unresponsive worker and releases its slot", async () => {
  const started = Promise.withResolvers<Worker>();
  const original = Worker.prototype.postMessage;
  const post = spyOn(Worker.prototype, "postMessage").mockImplementation(function (
    this: Worker,
    ...args: Parameters<Worker["postMessage"]>
  ) {
    // SAFETY: The client sends the protocol envelope through this intercepted Worker method.
    const { request } = args[0] as GeneratedImageWorkerMessage;
    if (request.kind === "inline" && request.itemId === "deadline") {
      started.resolve(this);
      return;
    }
    return original.apply(this, args);
  });
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const timedWorkers = yield* createGeneratedImageWorkers(() => Effect.void);
        return yield* Effect.gen(function* () {
          const job = yield* Effect.fork(
            timedWorkers.preparePayload(
              Effect.succeed({ kind: "inline", itemId: "deadline", base64: png }),
              "deadline",
            ),
          );
          const worker = yield* Effect.promise(() => started.promise);
          yield* TestClock.adjust("30 seconds");
          const failures = failureOf(yield* Fiber.await(job));
          expect(failures[0]?.details).toMatchObject({ phase: "deadline" });
          expect(worker.threadId).toBe(-1);
          expect(
            (yield* timedWorkers.preparePayload(
              Effect.succeed({ kind: "inline", itemId: "next", base64: png }),
              "next",
            )).base64,
          ).toBe(png);
        }).pipe(Effect.ensuring(timedWorkers.shutdown.pipe(Effect.orDie)));
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
  } finally {
    post.mockRestore();
  }
});

test("shutdown cancels active and queued jobs and rejects new jobs", async () => {
  const started = Promise.withResolvers<void>();
  const seen: Worker[] = [];
  const post = spyOn(Worker.prototype, "postMessage").mockImplementation(function (this: Worker) {
    seen.push(this);
    if (seen.length === 2) started.resolve();
  });
  const jobs = Array.from({ length: 3 }, () => Effect.runPromiseExit(payload()));
  try {
    await started.promise;
    await Effect.runPromise(workers.shutdown);
    expect((await Promise.all(jobs)).every(Exit.isFailure)).toBe(true);
    expect(seen).toHaveLength(2);
    expect(seen.every((worker) => worker.threadId === -1)).toBe(true);
    expect(failureOf(await Effect.runPromiseExit(payload()))[0]?.details).toMatchObject({
      phase: "shutdown",
    });
  } finally {
    await Effect.runPromise(workers.shutdown);
    post.mockRestore();
  }
});

test("termination failures remain visible at shutdown", async () => {
  const background: unknown[] = [];
  const failingWorkers = await Effect.runPromise(
    createGeneratedImageWorkers((failure) =>
      Effect.sync(() => {
        background.push(failure);
      }),
    ),
  );
  await Effect.runPromise(
    failingWorkers.preparePayload(
      Effect.succeed({ kind: "inline", itemId: "image", base64: png }),
      "image",
    ),
  );
  const original = Worker.prototype.terminate;
  const native = new Error("termination failed");
  const terminate = spyOn(Worker.prototype, "terminate").mockImplementation(
    async function (this: Worker) {
      await original.call(this);
      throw native;
    },
  );
  try {
    const failures = failureOf(await Effect.runPromiseExit(failingWorkers.shutdown));
    expect(failures).toMatchObject([
      { _tag: "HostOperationError", cause: native, details: { phase: "terminate" } },
    ]);
    expect(background).toEqual(failures);
  } finally {
    terminate.mockRestore();
  }
});

test("cancellation at scheduler boundaries preserves all admission slots", async () => {
  for (let steps = 0; steps < 24; steps++) {
    const scheduler = new Scheduler.ControlledScheduler();
    const job = Effect.runFork(
      workers.preparePayload(Effect.never, "cancel").pipe(Effect.withMaxOpsBeforeYield(10)),
      { scheduler },
    );
    for (let step = 0; step < steps; step++) scheduler.step();
    const interrupted = Effect.runPromise(Fiber.interrupt(job));
    scheduler.deferred = true;
    scheduler.step();
    await interrupted;
  }
  const started = Promise.withResolvers<void>();
  let active = 0;
  const jobs = Array.from({ length: 8 }, (_, index) =>
    Effect.runFork(
      workers.preparePayload(
        Effect.sync(() => {
          if (++active === 2) started.resolve();
        }).pipe(Effect.zipRight(Effect.never)),
        `held${index}`,
      ),
    ),
  );
  try {
    await started.promise;
    for (const job of jobs)
      expect(Option.isNone(await Effect.runPromise(Fiber.poll(job)))).toBe(true);
    expect(failureOf(await Effect.runPromiseExit(payload("overflow")))[0]?.details).toMatchObject({
      phase: "capacity",
    });
  } finally {
    await Promise.all(jobs.map((job) => Effect.runPromise(Fiber.interrupt(job))));
  }
});

test("idle worker errors stay visible and discard the failed worker", async () => {
  const seen: Worker[] = [];
  const original = Worker.prototype.postMessage;
  const post = spyOn(Worker.prototype, "postMessage").mockImplementation(function (
    this: Worker,
    ...args: Parameters<Worker["postMessage"]>
  ) {
    seen.push(this);
    return original.apply(this, args);
  });
  try {
    await Effect.runPromise(payload());
    const native = new Error("idle failure");
    seen[0]!.emit("error", native);
    expect(failureOf(await Effect.runPromiseExit(payload()))[0]?.cause).toBe(native);
    expect(seen[0]!.threadId).toBe(-1);
    expect((await Effect.runPromise(payload())).base64).toBe(png);
    expect(new Set(seen).size).toBe(2);
  } finally {
    post.mockRestore();
  }
});

test("idle workers expire and later jobs create a new worker", async () => {
  const seen: Worker[] = [];
  const original = Worker.prototype.postMessage;
  const post = spyOn(Worker.prototype, "postMessage").mockImplementation(function (
    this: Worker,
    ...args: Parameters<Worker["postMessage"]>
  ) {
    seen.push(this);
    return original.apply(this, args);
  });
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const timed = yield* createGeneratedImageWorkers(() => Effect.void);
        yield* Effect.gen(function* () {
          const request = timed.preparePayload(
            Effect.succeed({ kind: "inline", itemId: "idle", base64: png }),
            "idle",
          );
          yield* request;
          const exited = new Promise<void>((resolve) => seen[0]!.once("exit", () => resolve()));
          yield* TestClock.adjust("30 seconds");
          yield* Effect.promise(() => exited);
          expect(seen[0]!.threadId).toBe(-1);
          yield* request;
          expect(new Set(seen).size).toBe(2);
        }).pipe(Effect.ensuring(timed.shutdown.pipe(Effect.orDie)));
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
  } finally {
    post.mockRestore();
  }
});
