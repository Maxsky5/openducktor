import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

const workerPath = process.argv[2];
if (!workerPath)
  throw new Error("Give the Claude transcript worker bundle path as the first argument.");

const worker = new Worker(pathToFileURL(workerPath), { workerData: {} });

const send = (text: string): Promise<any> =>
  new Promise((resolveReply, reject) => {
    const bytes = Uint8Array.from(Buffer.from(text));
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

const records = [
  { type: "user", uuid: "first", message: { content: "first message" } },
  { type: "user", uuid: "second", message: { content: "second message" } },
];

try {
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
