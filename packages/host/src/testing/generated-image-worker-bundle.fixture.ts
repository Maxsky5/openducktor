import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

const workerPath = process.argv[2];
if (!workerPath)
  throw new Error("Give the generated image worker bundle path as the first argument.");

const worker = new Worker(pathToFileURL(workerPath));
let id = 0;

type ImageRequest =
  | { kind: "inline"; base64: string; itemId: string }
  | { kind: "file"; bytes: Uint8Array; itemId: string; revision: string }
  | { kind: "file-revision"; bytes: Uint8Array; itemId: string }
  | { kind: "history-start"; image: unknown; hasInlineOutput: boolean }
  | { kind: "history-chunk"; chunk: string }
  | { kind: "history-end" };

const send = (request: ImageRequest): Promise<any> =>
  new Promise((resolveReply, reject) => {
    const requestId = id++;
    const cleanup = () => {
      worker.off("message", message);
      worker.off("error", error);
      worker.off("exit", exit);
    };
    const error = (cause: Error) => {
      cleanup();
      reject(cause);
    };
    const exit = (code: number) => error(new Error(`Worker exited before response: ${code}`));
    const message = (reply: any) => {
      cleanup();
      try {
        assert.equal(reply.id, requestId);
        resolveReply(reply.result);
      } catch (cause) {
        reject(cause);
      }
    };
    worker.once("message", message);
    worker.once("error", error);
    worker.once("exit", exit);
    const buffer =
      request.kind === "file" || request.kind === "file-revision" ? request.bytes.buffer : null;
    worker.postMessage({ id: requestId, request }, buffer instanceof ArrayBuffer ? [buffer] : []);
  });

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=";

try {
  assert.deepEqual(await send({ kind: "inline", base64: png, itemId: "inline" }), {
    kind: "inline",
    byteLength: 68,
  });
  const bytes = Buffer.alloc(68);
  Buffer.from(png, "base64").copy(bytes);
  const revision = createHash("sha256").update("saved_file\0").update(bytes).digest("hex");
  const revisionBytes = Uint8Array.from(bytes);
  assert.deepEqual(await send({ kind: "file-revision", bytes: revisionBytes, itemId: "file" }), {
    kind: "revision",
    revision,
  });
  assert.equal(revisionBytes.buffer.byteLength, 0);
  const stale = await send({
    kind: "file",
    bytes: Uint8Array.from(bytes),
    itemId: "file",
    revision: "old",
  });
  assert.equal(stale.kind, "invalid");
  assert.ok(stale.message.includes("changed"));
  assert.deepEqual(await send({ kind: "file", bytes, itemId: "file", revision }), {
    kind: "payload",
    payload: { mime: "image/png", byteLength: 68, base64: png },
  });
  assert.equal(bytes.buffer.byteLength, 0);
  assert.deepEqual(
    await send({
      kind: "history-start",
      image: {
        item: {
          type: "imageGeneration",
          id: "history",
          status: "completed",
          result: "",
          revisedPrompt: null,
          failure: null,
        },
        context: {},
      },
      hasInlineOutput: true,
    }),
    { kind: "ack" },
  );
  assert.deepEqual(await send({ kind: "history-chunk", chunk: png }), { kind: "ack" });
  const history = await send({ kind: "history-end" });
  assert.equal(history.kind, "history");
  assert.equal(
    history.part.output.revision,
    createHash("sha256").update(`inline\0${png}`).digest("hex"),
  );
  const limit = 32 * 1024 * 1024;
  const boundary = Buffer.alloc(limit + 1);
  Buffer.from(png, "base64").copy(boundary);
  assert.deepEqual(
    await send({
      kind: "inline",
      base64: boundary.subarray(0, limit).toString("base64"),
      itemId: "limit",
    }),
    { kind: "inline", byteLength: limit },
  );
  const oversized = await send({
    kind: "inline",
    base64: boundary.toString("base64"),
    itemId: "oversized",
  });
  assert.equal(oversized.kind, "invalid");
  assert.ok(oversized.message.includes("32 MiB"));
  const invalid = await send({ kind: "inline", base64: "!!!!", itemId: "invalid" });
  assert.equal(invalid.kind, "invalid");
  assert.ok(!invalid.message.includes("!!!!"));
  console.log(
    `Worker bundle passed: ${process.versions.electron ? "Electron" : process.versions.bun ? "Bun" : "Node"} ${workerPath}`,
  );
} finally {
  await worker.terminate();
}
