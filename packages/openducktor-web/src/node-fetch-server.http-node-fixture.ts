import assert from "node:assert/strict";
import { request as httpRequest, type ClientRequest, type IncomingMessage } from "node:http";
import { test } from "node:test";
import { gzipSync, gunzipSync } from "node:zlib";
import { startNodeFetchServer } from "./node-fetch-server";
import { request } from "./node-http-test-client";

const json = JSON.stringify({ content: "host read content\n".repeat(350) });

test("negotiates gzip and preserves decoded JSON, errors, and CORS headers", async () => {
  const server = await startNodeFetchServer({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (incoming) =>
      new Response(json, {
        status: incoming.headers.has("test-error") ? 403 : 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-length": String(Buffer.byteLength(json)),
          vary: "Origin",
          "access-control-allow-origin": "https://runner.example",
          etag: '"json-tag"',
        },
      }),
    onError: (cause) => {
      throw cause;
    },
  });
  try {
    for (const encoding of ["gzip", "br, gzip;q=0.5", "GZip; Q=1", "*;q=0.5", "*;q=0, gzip;q=1"]) {
      const result = await request(server.port, "/", { "Accept-Encoding": encoding });
      assert.equal(result.status, 200);
      assert.equal(result.headers["content-encoding"], "gzip", encoding);
      assert.equal(result.headers["content-length"], undefined);
      assert.equal(result.headers.etag, 'W/"json-tag"');
      assert.equal(result.headers.vary, "Origin, Accept-Encoding");
      assert.equal(result.headers["access-control-allow-origin"], "https://runner.example");
      assert.equal(gunzipSync(result.body).toString(), json);
      assert.ok(result.body.length < Buffer.byteLength(json) / 2);
    }
    for (const encoding of [
      undefined,
      "",
      "identity",
      "br",
      "gzip;q=0",
      "gzip;q=0, *;q=1",
      "gzip;q=0.2, identity;q=1",
      "notgzip",
    ]) {
      const result = await request(
        server.port,
        "/",
        encoding === undefined ? {} : { "Accept-Encoding": encoding },
      );
      assert.equal(result.headers["content-encoding"], undefined, encoding ?? "absent header");
      assert.equal(result.body.toString(), json);
      assert.equal(result.headers.vary, "Origin, Accept-Encoding");
      assert.equal(Number(result.headers["content-length"]), Buffer.byteLength(json));
    }
    const failure = await request(server.port, "/", {
      "Accept-Encoding": "gzip",
      "test-error": "1",
    });
    assert.equal(failure.status, 403);
    assert.equal(gunzipSync(failure.body).toString(), json);
    const head = await request(server.port, "/", { "Accept-Encoding": "gzip" }, "HEAD");
    assert.equal(head.body.length, 0);
    assert.equal(head.headers["content-encoding"], "gzip");
    assert.equal(head.headers["content-length"], undefined);
    console.log(
      `JSON: identity ${Buffer.byteLength(json)} bytes, gzip ${failure.body.length} bytes`,
    );
  } finally {
    await server.stop(true);
  }
});

test("keeps short bodies small and compresses larger bodies with or without a length", async () => {
  const cases = [
    { bytes: Buffer.from('{"ok":true}'), status: 200 },
    { bytes: Buffer.from("Forbidden."), status: 403 },
    { bytes: Buffer.alloc(1023, "a"), status: 200 },
    { bytes: Buffer.from("é".repeat(512)), status: 200 },
    { bytes: Buffer.alloc(4096, "b"), status: 200 },
  ];
  const server = await startNodeFetchServer({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (incoming) => {
      const index = Number(incoming.headers.get("test-case"));
      const entry = cases[index];
      assert.ok(entry);
      const mode = incoming.headers.get("test-mode");
      const headers = new Headers({ "content-type": "text/plain", etag: `"body-${index}"` });
      if (mode === "known") headers.set("content-length", String(entry.bytes.length));
      let offset = 0;
      const body =
        mode === "split"
          ? new ReadableStream<Uint8Array>({
              pull(controller) {
                if (offset === entry.bytes.length) controller.close();
                else {
                  controller.enqueue(entry.bytes.subarray(offset, offset + 128));
                  offset = Math.min(offset + 128, entry.bytes.length);
                }
              },
            })
          : new Uint8Array(entry.bytes);
      return new Response(body, { status: entry.status, headers });
    },
    onError: (cause) => {
      throw cause;
    },
  });
  try {
    for (const mode of ["known", "unknown", "split"]) {
      for (const [index, { bytes, status }] of cases.entries()) {
        const headers = {
          "Accept-Encoding": "gzip",
          "test-case": String(index),
          "test-mode": mode,
        };
        const result = await request(server.port, "/", headers);
        const gzip = bytes.length >= 1024;
        assert.equal(result.status, status);
        assert.equal(result.headers["content-encoding"], gzip ? "gzip" : undefined);
        assert.deepEqual(gzip ? gunzipSync(result.body) : result.body, bytes);
        assert.equal(result.headers.etag, gzip ? `W/"body-${index}"` : `"body-${index}"`);
        assert.equal(result.headers.vary, "Accept-Encoding");
        if (gzip) assert.ok(result.body.length < bytes.length);
        else {
          assert.equal(result.body.length, bytes.length);
          assert.equal(Number(result.headers["content-length"]), bytes.length);
        }
        if (mode === "known") {
          const head = await request(server.port, "/", headers, "HEAD");
          assert.equal(head.body.length, 0);
          assert.equal(head.headers["content-encoding"], result.headers["content-encoding"]);
          assert.equal(head.headers["content-length"], result.headers["content-length"]);
          assert.equal(head.headers.etag, result.headers.etag);
        }
      }
    }
  } finally {
    await server.stop(true);
  }
});

test("preserves binary, encoded, partial, and no-transform responses", async () => {
  const encoded = gzipSync(json);
  const server = await startNodeFetchServer({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (incoming) => {
      const mode = incoming.headers.get("test-mode");
      const headers = new Headers({
        "content-type": mode === "binary" ? "image/png" : "text/plain",
        vary: "*",
      });
      if (mode === "encoded") headers.set("content-encoding", "gzip");
      if (mode === "partial")
        headers.set("content-range", `bytes 0-${json.length - 1}/${json.length}`);
      if (mode === "no-transform") headers.set("cache-control", "private, no-transform");
      return new Response(mode === "encoded" ? new Uint8Array(encoded) : json, {
        status: mode === "partial" ? 206 : 200,
        headers,
      });
    },
    onError: (cause) => {
      throw cause;
    },
  });
  try {
    for (const mode of ["binary", "encoded", "partial", "no-transform"]) {
      const result = await request(server.port, "/", {
        "Accept-Encoding": "gzip",
        "test-mode": mode,
      });
      assert.deepEqual(result.body, mode === "encoded" ? encoded : Buffer.from(json));
      assert.equal(result.headers["content-encoding"], mode === "encoded" ? "gzip" : undefined);
      assert.equal(result.status, mode === "partial" ? 206 : 200);
      assert.equal(result.headers.vary, "*");
    }
  } finally {
    await server.stop(true);
  }
});

test("starts a large response before its source closes", { timeout: 1000 }, async () => {
  const prefix = Buffer.alloc(1024, "a");
  const tail = Buffer.from("last bytes");
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const server = await startNodeFetchServer({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            controller = stream;
            stream.enqueue(prefix);
          },
        }),
        { headers: { "content-type": "text/plain" } },
      ),
    onError: (cause) => {
      throw cause;
    },
  });
  const incoming = httpRequest({
    hostname: "127.0.0.1",
    port: server.port,
    headers: { "Accept-Encoding": "gzip" },
  });
  try {
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      incoming.on("response", resolve);
      incoming.on("error", reject);
      incoming.end();
    });
    assert.equal(response.headers["content-encoding"], "gzip");
    assert.ok(controller);
    controller.enqueue(tail);
    controller.close();
    const chunks: Buffer[] = [];
    for await (const chunk of response) chunks.push(chunk);
    assert.deepEqual(gunzipSync(Buffer.concat(chunks)), Buffer.concat([prefix, tail]));
  } finally {
    incoming.destroy();
    await server.stop(true);
  }
});

test("cancels a pending prefix read when the client disconnects", async () => {
  const started = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<void>();
  const errors: unknown[] = [];
  const server = await startNodeFetchServer({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            stream.enqueue(Buffer.from("small"));
            started.resolve();
          },
          cancel() {
            cancelled.resolve();
          },
        }),
        { headers: { "content-type": "text/plain" } },
      ),
    onError: (cause) => errors.push(cause),
  });
  const incoming = httpRequest({
    hostname: "127.0.0.1",
    port: server.port,
    headers: { "Accept-Encoding": "gzip" },
  });
  // Destroying the request can report ECONNRESET on the client.
  incoming.on("error", () => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    incoming.end();
    await started.promise;
    incoming.destroy();
    await Promise.race([
      cancelled.promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("The response body was not cancelled.")), 500);
      }),
    ]);
    assert.deepEqual(errors, []);
  } finally {
    clearTimeout(timer);
    incoming.destroy();
    await server.stop(true);
  }
});

test("reports a failed prefix read instead of sending a partial success", async () => {
  const failure = new Error("Body read failed.");
  const errors: unknown[] = [];
  const server = await startNodeFetchServer({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            stream.enqueue(Buffer.from("small"));
            stream.error(failure);
          },
        }),
        { headers: { "content-type": "text/plain" } },
      ),
    onError: (cause) => errors.push(cause),
  });
  try {
    const result = await request(server.port, "/", { "Accept-Encoding": "gzip" });
    assert.equal(result.status, 500);
    assert.equal(result.headers["content-encoding"], undefined);
    assert.equal(result.body.toString(), "Internal server error.");
    assert.deepEqual(errors, [failure]);
  } finally {
    await server.stop(true);
  }
});

test(
  "delivers each SSE event before the next publication with gzip advertised",
  { timeout: 2000 },
  async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    const server = await startNodeFetchServer({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(stream) {
              controller = stream;
              stream.enqueue(encoder.encode(": ready\n\n"));
            },
          }),
          {
            headers: {
              "content-type": "text/event-stream; charset=utf-8",
              "cache-control": "no-cache",
            },
          },
        ),
      onError: (cause) => {
        throw cause;
      },
    });
    const incoming = httpRequest({
      hostname: "127.0.0.1",
      port: server.port,
      headers: { "Accept-Encoding": "gzip" },
    });
    try {
      const result = await readFrames(incoming);
      assert.equal(result.response.headers["content-encoding"], undefined);
      assert.equal(await result.nextFrame(), ": ready\n\n");
      assert.ok(controller);
      for (const id of [1, 2, 3]) {
        const frame = `id: ${id}\ndata: event ${id}\n\n`;
        const started = performance.now();
        controller.enqueue(encoder.encode(frame));
        const received = await result.nextFrame();
        assert.equal(received, frame);
        console.log(`SSE event ${id}: ${(performance.now() - started).toFixed(2)} ms`);
      }
      result.response.destroy();
    } finally {
      incoming.destroy();
      await server.stop(true);
    }
  },
);

// HTTP chunks can split an SSE frame. Keep the tail until its blank line arrives.
function readFrames(incoming: ClientRequest): Promise<{
  response: IncomingMessage;
  nextFrame: () => Promise<string>;
}> {
  return new Promise((resolve, reject) => {
    incoming.on("error", reject);
    incoming.setTimeout(1000, () => incoming.destroy(new Error("SSE delivery stalled.")));
    incoming.on("response", (response) => {
      let pending = "";
      const frames: string[] = [];
      let waiter: ((frame: string) => void) | null = null;
      response.on("data", (chunk: Buffer) => {
        pending += chunk.toString();
        let boundary: number;
        while ((boundary = pending.indexOf("\n\n")) !== -1) {
          const frame = pending.slice(0, boundary + 2);
          pending = pending.slice(boundary + 2);
          if (waiter) {
            const resolveFrame = waiter;
            waiter = null;
            resolveFrame(frame);
          } else frames.push(frame);
        }
      });
      resolve({
        response,
        nextFrame: () => {
          const frame = frames.shift();
          if (frame !== undefined) return Promise.resolve(frame);
          return new Promise((resolveFrame, rejectFrame) => {
            const timer = setTimeout(
              () => rejectFrame(new Error("SSE frame did not arrive within 500 ms.")),
              500,
            );
            waiter = (next) => {
              clearTimeout(timer);
              resolveFrame(next);
            };
          });
        },
      });
    });
    incoming.end();
  });
}
