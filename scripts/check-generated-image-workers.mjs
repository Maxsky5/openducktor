import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

const script = fileURLToPath(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const workerPath = process.argv[2];
if (!workerPath) {
  const electron = createRequire(new URL("../apps/electron/package.json", import.meta.url))(
    "electron",
  );
  for (const [runtime, artifact] of [
    [process.execPath, "apps/electron/dist/generated-image-worker.js"],
    ["bun", "packages/openducktor-web/dist/generated-image-worker.js"],
    [electron, "apps/electron/dist/generated-image-worker.js"],
  ]) {
    const result = spawnSync(runtime, [script, resolve(root, artifact)], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "inherit",
      timeout: 5000,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `Worker bundle check failed under ${runtime}`);
  }
} else {
  const worker = new Worker(pathToFileURL(workerPath));
  let id = 0;
  const send = (request) =>
    new Promise((resolveReply, reject) => {
      const requestId = id++;
      const cleanup = () => {
        worker.off("message", message);
        worker.off("error", error);
        worker.off("exit", exit);
      };
      const error = (cause) => {
        cleanup();
        reject(cause);
      };
      const exit = (code) => error(new Error(`Worker exited before response: ${code}`));
      const message = (reply) => {
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
      worker.postMessage(
        { id: requestId, request },
        request.kind === "file" ? [request.bytes.buffer] : [],
      );
    });
  try {
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=";
    assert.deepEqual(await send({ kind: "inline", base64: png, itemId: "inline" }), {
      kind: "inline",
      byteLength: 68,
    });
    const bytes = Buffer.alloc(68);
    Buffer.from(png, "base64").copy(bytes);
    assert.deepEqual(await send({ kind: "file", bytes, itemId: "file" }), {
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
}
