import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { checkWorkerBundles } from "./worker-bundle-checks.mjs";

const workerPath = process.argv[2];
if (!workerPath) {
  checkWorkerBundles(import.meta.url, "claude-transcript-worker.js");
} else {
  const worker = new Worker(pathToFileURL(workerPath), { workerData: {} });
  const send = (text) =>
    new Promise((resolveReply, reject) => {
      const bytes = Uint8Array.from(Buffer.from(text));
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
          assert.equal(Buffer.from(reply.buffer).toString(), text);
          resolveReply(reply);
        } catch (cause) {
          reject(cause);
        }
      };
      worker.once("message", message);
      worker.once("error", error);
      worker.once("exit", exit);
      worker.postMessage({ buffer: bytes.buffer, byteLength: bytes.byteLength }, [bytes.buffer]);
      assert.equal(bytes.buffer.byteLength, 0);
    });
  try {
    const records = [
      { type: "user", uuid: "first", message: { content: "first message" } },
      { type: "user", uuid: "second", message: { content: "second message" } },
    ];
    const transcript = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
    const parsed = await send(transcript);
    assert.equal(parsed.kind, "complete");
    assert.equal(parsed.lineCount, 2);
    assert.deepEqual(parsed.records, records);

    const invalid = await send(`${JSON.stringify(records[0])}\n{\n`);
    assert.equal(invalid.kind, "error");
    assert.equal(invalid.error.lineIndex, 1);
    assert.ok(invalid.error.cause instanceof Error);

    const next = await send(`${JSON.stringify(records[1])}\n`);
    assert.equal(next.kind, "complete");
    assert.deepEqual(next.records, [records[1]]);
    console.log(
      `Worker bundle passed: ${process.versions.electron ? "Electron" : process.versions.bun ? "Bun" : "Node"} ${workerPath}`,
    );
  } finally {
    await worker.terminate();
  }
}
