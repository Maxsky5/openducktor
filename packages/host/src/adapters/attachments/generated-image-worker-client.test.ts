import { expect, spyOn, test } from "bun:test";
import { Worker } from "node:worker_threads";
import { codexImageGenerationPart } from "@openducktor/adapters-codex-app-server";
import type { CodexAppServerThreadItem } from "@openducktor/contracts";
import { Cause, Effect, Exit, Fiber } from "effect";
import { z } from "zod";
import {
  prepareGeneratedImagePayload,
  prepareHostCodexImages,
} from "./generated-image-worker-client";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=";
const itemIdentity = z.object({ itemId: z.string() });

test("host image preparation preserves the live and history revision algorithm", async () => {
  const inline: Extract<CodexAppServerThreadItem, { type: "imageGeneration" }> = {
    type: "imageGeneration",
    id: "inline",
    status: "completed",
    result: png,
    revisedPrompt: null,
    failure: null,
  };
  const images = [
    inline,
    { ...inline, id: "saved", savedPath: "/output.png" },
    { ...inline, id: "running", status: "in_progress" },
  ].map((item) => ({ item, context: { turnId: "turn" } }));
  expect(await prepareHostCodexImages(images)).toEqual(
    images.map(({ item, context }) => codexImageGenerationPart(item, context)),
  );
});

for (const failure of ["error", "exit", "malformed"] as const) {
  test(`host worker ${failure} stays a typed image error`, async () => {
    const itemId = `worker-failure-${failure}`;
    const postMessage = Worker.prototype.postMessage;
    const post = spyOn(Worker.prototype, "postMessage").mockImplementation(function (
      this: Worker,
      ...args: Parameters<Worker["postMessage"]>
    ) {
      const identity = itemIdentity.safeParse(args[0]);
      if (!identity.success || identity.data.itemId !== itemId)
        return postMessage.apply(this, args);
      if (failure === "error") this.emit("error", new Error("worker failure"));
      else if (failure === "exit") this.emit("exit", 1);
      else this.emit("message", { kind: "payload", payload: { base64: "private-invalid" } });
    });
    try {
      const exit = await Effect.runPromiseExit(
        prepareGeneratedImagePayload({ kind: "inline", itemId, base64: png }),
      );
      if (!Exit.isFailure(exit)) throw new Error("Expected worker failure");
      expect([...Cause.defects(exit.cause)]).toEqual([]);
      expect([...Cause.failures(exit.cause)]).toMatchObject([
        { _tag: "HostOperationError", operation: "generated-image.read", details: { itemId } },
      ]);
    } finally {
      post.mockRestore();
    }
  });
}

test("host worker slots bound concurrency and interruption stops active and queued work", async () => {
  const prefix = "worker-slot-";
  const started = Promise.withResolvers<void>();
  const workers: Worker[] = [];
  const postMessage = Worker.prototype.postMessage;
  const post = spyOn(Worker.prototype, "postMessage").mockImplementation(function (
    this: Worker,
    ...args: Parameters<Worker["postMessage"]>
  ) {
    const identity = itemIdentity.safeParse(args[0]);
    if (!identity.success || !identity.data.itemId.startsWith(prefix))
      return postMessage.apply(this, args);
    workers.push(this);
    if (workers.length === 2) started.resolve();
  });
  const fibers = [0, 1, 2].map((index) =>
    Effect.runFork(
      prepareGeneratedImagePayload({ kind: "inline", itemId: `${prefix}${index}`, base64: png }),
    ),
  );
  try {
    await started.promise;
    expect(workers).toHaveLength(2);
    await Effect.runPromise(Fiber.interrupt(fibers[2]!));
    for (const fiber of fibers.slice(0, 2)) {
      const exit = await Effect.runPromise(Fiber.interrupt(fiber));
      if (!Exit.isFailure(exit)) throw new Error("Expected interruption");
      expect(Cause.isInterrupted(exit.cause)).toBe(true);
    }
    expect(workers).toHaveLength(2);
    expect(workers.map((worker) => worker.threadId)).toEqual([-1, -1]);
  } finally {
    await Promise.all(fibers.map((fiber) => Effect.runPromise(Fiber.interrupt(fiber))));
    post.mockRestore();
  }
});
