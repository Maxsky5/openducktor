import { expect, spyOn, test } from "bun:test";
import { Buffer } from "node:buffer";
import { Worker } from "node:worker_threads";
import { Effect } from "effect";
import { z } from "zod";
import { HostOperationError } from "../../effect/host-errors";
import type { ClaudeProtocolObject } from "./claude-agent-sdk-ingress-schemas";
import {
  ClaudeTranscriptWorkerBatchError,
  createClaudeTranscriptWorkerPool,
} from "./claude-transcript-worker-pool";
import type { ClaudeTranscriptWorkerRequest } from "./claude-transcript-worker-protocol";

const batch = (source: string) => {
  const bytes = Buffer.from(source);
  const buffer = Buffer.allocUnsafeSlow(bytes.length);
  bytes.copy(buffer);
  // SAFETY: allocUnsafeSlow gives this Buffer its own transferable ArrayBuffer.
  return { buffer: buffer.buffer as ArrayBuffer, byteLength: bytes.length };
};

const observePoolWorkers = () => {
  const buffers = new WeakSet<ArrayBuffer>();
  const workers = new Set<Worker>();
  const postMessage = Worker.prototype.postMessage;
  const observer = spyOn(Worker.prototype, "postMessage").mockImplementation(function (
    this: Worker,
    ...args: Parameters<Worker["postMessage"]>
  ) {
    // SAFETY: Only requests with this test's owned buffer enter the observed pool.
    const request = args[0] as ClaudeTranscriptWorkerRequest;
    if (request?.buffer && buffers.has(request.buffer)) workers.add(this);
    return postMessage.apply(this, args);
  });
  return { buffers, workers, restore: () => observer.mockRestore() };
};

test("four transcript slots transfer owned buffers back and retain physical line counts and record order", async () => {
  const pool = await Effect.runPromise(createClaudeTranscriptWorkerPool());
  try {
    const jobs = pool.slots.map((slot, index) => {
      const source = [
        "",
        '{"type":"unused"}',
        JSON.stringify({ type: "user", uuid: `first-${index}`, message: { content: "é😀" } }),
        JSON.stringify({ type: "assistant", uuid: `last-${index}` }),
        "",
      ].join("\n");
      const input = batch(source);
      const job = slot.parse(input.buffer, input.byteLength);
      expect(input.buffer.byteLength).toBe(0);
      return job.then((result) => ({ result, source, index }));
    });
    for (const { result, source, index } of await Promise.all(jobs)) {
      expect(result.lineCount).toBe(4);
      expect(Buffer.from(result.buffer).toString()).toBe(source);
      expect(result.records).toEqual([
        { type: "user", uuid: `first-${index}`, message: { content: "é😀" } },
        { type: "assistant", uuid: `last-${index}` },
      ]);
    }
  } finally {
    await pool.close();
  }
});

test("worker transport keeps full tool input and JSON-owned keys while capping output and removing media bytes", async () => {
  const pool = await Effect.runPromise(createClaudeTranscriptWorkerPool());
  try {
    const content = "written line é😀\n".repeat(8000);
    // SAFETY: This fixture parses fixed JSON to create an own __proto__ data property.
    const input = JSON.parse('{"__proto__":{"owned":true}}') as ClaudeProtocolObject;
    input.file_path = "/repo/full.ts";
    input.content = content;
    input.old_string = content;
    input.new_string = `${content}new line\n`;
    const output = "tool output é😀\n".repeat(8000);
    const source = batch(
      `${JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "write-1", name: "Write", input },
            { type: "tool_result", tool_use_id: "write-1", content: output },
            { type: "image", source: { media_type: "image/png", data: "A".repeat(100_000) } },
          ],
        },
      })}\n`,
    );
    const result = await pool.slots[0]!.parse(source.buffer, source.byteLength);
    expect(result.records).toEqual([
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "write-1", name: "Write", input },
            { type: "tool_result", tool_use_id: "write-1", content: expect.any(String) },
            { type: "image", source: { media_type: "image/png" } },
          ],
        },
      },
    ]);
    const message = z
      .object({
        content: z.tuple([
          z.object({ input: z.unknown() }),
          z.object({ content: z.string() }),
          z.unknown(),
        ]),
      })
      .parse(result.records[0]!.message);
    const returnedInput = message.content[0].input;
    expect(Object.prototype.hasOwnProperty.call(returnedInput, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(returnedInput)).toBe(Object.prototype);
    const returnedOutput = message.content[1].content;
    expect(Buffer.byteLength(returnedOutput)).toBeLessThanOrEqual(64 * 1024);
    expect(returnedOutput).toEndWith(
      `[Claude tool output truncated; original size: ${Buffer.byteLength(output)} UTF-8 bytes]`,
    );
    expect(returnedOutput).not.toContain("�");
  } finally {
    await pool.close();
  }
});

test.each(["metadataOnly", "summaryOnly"] as const)(
  "transcript workers apply the %s retention policy",
  async (mode) => {
    const pool = await Effect.runPromise(createClaudeTranscriptWorkerPool({ [mode]: true }));
    try {
      const input = batch(
        `${JSON.stringify({
          type: "assistant",
          sessionId: "session-1",
          uuid: "assistant-1",
          message: { content: [{ type: "text", text: "Complete text" }] },
        })}\n`,
      );
      const result = await pool.slots[0]!.parse(input.buffer, input.byteLength);
      const expected = { type: "assistant", sessionId: "session-1", uuid: "assistant-1" };
      expect(result.records).toEqual([
        mode === "metadataOnly"
          ? expected
          : { ...expected, message: { content: [{ type: "text", text: "x" }] } },
      ]);
    } finally {
      await pool.close();
    }
  },
);

test("a transcript slot rejects a second pending batch without transferring it", async () => {
  const pool = await Effect.runPromise(createClaudeTranscriptWorkerPool());
  try {
    const first = batch('{"type":"user","uuid":"first"}\n');
    const pending = pool.slots[0]!.parse(first.buffer, first.byteLength);
    const second = batch('{"type":"user","uuid":"second"}\n');
    const rejected = await pool.slots[0]!.parse(second.buffer, second.byteLength).then(
      () => null,
      (cause: unknown) => cause,
    );
    if (!(rejected instanceof HostOperationError)) throw new Error("Expected a busy slot failure");
    expect(rejected.operation).toBe("claude.transcript.worker.busy");
    expect(second.buffer.byteLength).toBe(second.byteLength);
    expect((await pending).records).toEqual([{ type: "user", uuid: "first" }]);
  } finally {
    await pool.close();
  }
});

test("a malformed worker line keeps its physical index after blank and discarded records", async () => {
  const pool = await Effect.runPromise(createClaudeTranscriptWorkerPool());
  try {
    const input = batch('\n{"type":"unused"}\n{"type":"user","message":}\n');
    const result = await pool.slots[2]!.parse(input.buffer, input.byteLength).then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(result).toBeInstanceOf(HostOperationError);
    if (!(result instanceof HostOperationError)) throw new Error("Expected a host worker failure");
    expect(result.cause).toBeInstanceOf(ClaudeTranscriptWorkerBatchError);
    if (!(result.cause instanceof ClaudeTranscriptWorkerBatchError))
      throw new Error("Expected a worker batch failure");
    expect(result.cause.slotIndex).toBe(2);
    expect(result.cause.lineIndex).toBe(2);
    expect(result.cause.reason).toBe("malformed");
    expect(result.cause.cause).toBeInstanceOf(Error);
  } finally {
    await pool.close();
  }
});

test.each([
  ["unterminated", '{"type":"user"}'],
  ["oversize", `{"type":"user","snapshots":"${"é".repeat(1024 * 1024)}"}\n`],
] as const)("workers reject %s records without serial parsing", async (reason, source) => {
  const pool = await Effect.runPromise(createClaudeTranscriptWorkerPool());
  try {
    const input = batch(source);
    const result = await pool.slots[0]!.parse(input.buffer, input.byteLength).then(
      () => null,
      (cause: unknown) => cause,
    );
    if (
      !(result instanceof HostOperationError) ||
      !(result.cause instanceof ClaudeTranscriptWorkerBatchError)
    ) {
      throw new Error("Expected a typed worker batch failure");
    }
    expect(result.cause.reason).toBe(reason);
    expect(result.cause.lineIndex).toBe(0);
  } finally {
    await pool.close();
  }
});

test("closing a transcript pool rejects pending jobs once and waits for all four worker terminations", async () => {
  const observed = observePoolWorkers();
  const terminate = Worker.prototype.terminate;
  let finished = 0;
  let started = 0;
  const termination = spyOn(Worker.prototype, "terminate").mockImplementation(function (
    this: Worker,
  ) {
    const owned = observed.workers.has(this);
    if (owned) started++;
    return terminate.call(this).then((code) => {
      if (owned) finished++;
      return code;
    });
  });
  const pool = await Effect.runPromise(createClaudeTranscriptWorkerPool());
  try {
    const pending = pool.slots.map((slot) => {
      const input = batch('{"type":"user"}\n');
      observed.buffers.add(input.buffer);
      return slot.parse(input.buffer, input.byteLength).then(
        () => null,
        (cause: unknown) => cause,
      );
    });
    await pool.close();
    await pool.close();
    expect(finished).toBe(4);
    expect(started).toBe(4);
    for (const result of await Promise.all(pending)) {
      expect(result).toBeInstanceOf(HostOperationError);
    }
  } finally {
    await pool.close();
    termination.mockRestore();
    observed.restore();
  }
});

test("an unexpected idle worker exit closes its pool and fails later work", async () => {
  const observed = observePoolWorkers();
  const pool = await Effect.runPromise(createClaudeTranscriptWorkerPool());
  try {
    const input = batch('{"type":"user"}\n');
    observed.buffers.add(input.buffer);
    await pool.slots[0]!.parse(input.buffer, input.byteLength);
    const worker = [...observed.workers][0]!;
    await worker.terminate();
    const next = batch('{"type":"assistant"}\n');
    const result = await pool.slots[1]!.parse(next.buffer, next.byteLength).then(
      () => null,
      (cause: unknown) => cause,
    );
    if (!(result instanceof HostOperationError)) throw new Error("Expected a host worker failure");
    expect(result.operation).toBe("claude.transcript.worker.exit");
    await pool.close();
  } finally {
    await pool.close();
    observed.restore();
  }
});
