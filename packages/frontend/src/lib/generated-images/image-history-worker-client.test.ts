import { expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  codexImageGenerationPart,
  type CodexImageGenerationPreparation,
} from "@openducktor/adapters-codex-app-server";
import { LOCAL_ATTACHMENT_BASE64_CHARACTER_LIMIT } from "@openducktor/contracts";
import { prepareCodexImageGenerations } from "./image-history-worker-client";
import {
  IMAGE_HISTORY_CHUNK_BYTES,
  type ImageHistoryWorkerRequest,
  type ImageHistoryWorkerResponse,
} from "./image-history-worker-protocol";

const image = (result: string, id = "image"): CodexImageGenerationPreparation => ({
  item: {
    type: "imageGeneration",
    id,
    status: "completed",
    result,
    revisedPrompt: null,
    transparentBackground: null,
    failure: null,
  },
  context: { turnId: "turn", turnStatus: "completed" },
});
const digest = (result: string) =>
  createHash("sha256").update("inline\0").update(result).digest("hex");

test("real history worker hashes an oversized inline result without changing its completed outcome", async () => {
  const source = image("A".repeat(LOCAL_ATTACHMENT_BASE64_CHARACTER_LIMIT + 1));
  const expected = digest(source.item.result);
  const parts = await prepareCodexImageGenerations([source]);
  expect(parts).toMatchObject([{ status: "completed", output: { revision: expected } }]);
});

test("real history worker preserves Unicode across chunks and keeps native item order and outcomes", async () => {
  const boundary = Math.floor(IMAGE_HISTORY_CHUNK_BYTES / 3);
  const sources = [
    image(`${"a".repeat(boundary - 1)}🦆\ud800x\udc00${"界".repeat(boundary)}`, "unicode"),
    image("", "empty"),
    {
      ...image("ignored", "saved"),
      item: { ...image("ignored", "saved").item, savedPath: "/image.png" },
    },
    {
      ...image("ignored", "failed"),
      item: {
        ...image("ignored", "failed").item,
        status: "failed",
        failure: { type: "usageLimitExceeded" as const, limitId: "images", resetsAt: 100 },
      },
    },
    {
      ...image("ignored", "interrupted"),
      item: { ...image("ignored", "interrupted").item, status: "in_progress" },
      context: { turnStatus: "interrupted" as const },
    },
  ];
  expect(await prepareCodexImageGenerations(sources)).toEqual(
    sources.map(({ item, context }) => codexImageGenerationPart(item, context)),
  );
});

class HeldWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  requests: ImageHistoryWorkerRequest[] = [];
  terminate = mock(() => {});
  postMessage = (request: ImageHistoryWorkerRequest, transfer: Transferable[]) => {
    this.requests.push(structuredClone(request, { transfer }));
  };
  reply(data: ImageHistoryWorkerResponse | null) {
    this.onmessage?.({ data });
  }
}

const withWorkers = async (work: (workers: HeldWorker[]) => Promise<void>) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker")!;
  const workers: HeldWorker[] = [];
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: class extends HeldWorker {
      constructor() {
        super();
        workers.push(this);
      }
    },
  });
  try {
    await work(workers);
  } finally {
    Object.defineProperty(globalThis, "Worker", descriptor);
  }
};

test("many large images transfer one bounded chunk per acknowledgment without cloning raw results", async () => {
  await withWorkers(async (workers) => {
    const sources = Array.from({ length: 8 }, (_, index) =>
      image("界".repeat(IMAGE_HISTORY_CHUNK_BYTES), String(index)),
    );
    const pending = prepareCodexImageGenerations(sources);
    await Promise.resolve();
    const worker = workers[0]!;
    let count = 0;
    let maxBytes = 0;
    let current: CodexImageGenerationPreparation | undefined;
    let hash = createHash("sha256");
    for (let index = 0; index < worker.requests.length; index++) {
      const request = worker.requests[index]!;
      expect(worker.requests).toHaveLength(index + 1);
      if (request.kind === "start") {
        expect(request.image.item.result).toBe("");
        current = request.image;
        hash = createHash("sha256").update("inline\0");
      }
      if (request.kind === "chunk") {
        expect(request.bytes.byteLength).toBeLessThanOrEqual(IMAGE_HISTORY_CHUNK_BYTES);
        maxBytes = Math.max(maxBytes, request.bytes.byteLength);
        hash.update(request.bytes);
        count++;
      }
      if (request.kind === "end")
        worker.reply({
          id: request.id,
          kind: "part",
          part: codexImageGenerationPart(current!.item, current!.context, hash.digest("hex")),
        });
      else worker.reply({ id: request.id, kind: "ack" });
      await Promise.resolve();
    }
    expect(await pending).toEqual(
      sources.map(({ item, context }) => codexImageGenerationPart(item, context)),
    );
    expect(count).toBeGreaterThan(sources.length);
    expect(maxBytes).toBe(IMAGE_HISTORY_CHUNK_BYTES - 1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});

for (const failure of [
  "abort",
  "error",
  "messageerror",
  "wrong-id",
  "wrong-kind",
  "malformed",
  "worker-error",
  "post",
] as const) {
  test(`${failure} stops history chunks and ignores a late acknowledgment`, async () => {
    await withWorkers(async (workers) => {
      const controller = new AbortController();
      const pending = prepareCodexImageGenerations(
        [image("A".repeat(IMAGE_HISTORY_CHUNK_BYTES * 2))],
        controller.signal,
      );
      await Promise.resolve();
      const worker = workers[0]!;
      worker.reply({ id: 0, kind: "ack" });
      await Promise.resolve();
      expect(worker.requests.at(-1)?.kind).toBe("chunk");
      const lateReply = worker.onmessage!;
      if (failure === "abort") controller.abort(new Error("cancelled"));
      if (failure === "error") worker.onerror!();
      if (failure === "messageerror") worker.onmessageerror!();
      if (failure === "wrong-id") worker.reply({ id: 0, kind: "ack" });
      if (failure === "wrong-kind")
        worker.reply({ id: 1, kind: "part", part: codexImageGenerationPart(image("").item) });
      if (failure === "malformed") worker.reply(null);
      if (failure === "worker-error")
        worker.reply({ id: 1, kind: "error", message: "hash failed" });
      if (failure === "post") {
        worker.postMessage = () => {
          throw new Error("post failed");
        };
        worker.reply({ id: 1, kind: "ack" });
      }
      await expect(pending).rejects.toThrow();
      lateReply({ data: { id: 1, kind: "ack" } });
      await Promise.resolve();
      expect(worker.requests).toHaveLength(2);
      expect(worker.terminate).toHaveBeenCalledTimes(1);
      controller.abort();
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    });
  });
}

test("history admits two workers, removes cancelled waiters, and releases failed worker slots", async () => {
  await withWorkers(async (workers) => {
    const controllers = Array.from({ length: 4 }, () => new AbortController());
    const pending = controllers.map(({ signal }) =>
      prepareCodexImageGenerations(
        [image("A".repeat(IMAGE_HISTORY_CHUNK_BYTES * 2))],
        signal,
      ).catch((error: Error) => error),
    );
    await Promise.resolve();
    expect(workers).toHaveLength(2);
    for (const worker of workers) worker.reply({ id: 0, kind: "ack" });
    await Promise.resolve();
    expect(
      workers.reduce((bytes, worker) => {
        const request = worker.requests.at(-1)!;
        return bytes + (request.kind === "chunk" ? request.bytes.byteLength : 0);
      }, 0),
    ).toBeLessThanOrEqual(IMAGE_HISTORY_CHUNK_BYTES * 2);
    controllers[2]!.abort(new Error("queued cancellation"));
    workers[0]!.onerror!();
    await pending[0];
    await Promise.resolve();
    expect(workers).toHaveLength(3);
    for (const controller of controllers) controller.abort(new Error("cancelled"));
    const results = await Promise.all(pending);
    expect(results[2]).toEqual(new Error("queued cancellation"));
    expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
  });
});
