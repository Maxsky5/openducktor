import { Buffer } from "node:buffer";
import type { FileHandle } from "node:fs/promises";
import { AgentRuntimeQueryError } from "@openducktor/core";
import { Effect } from "effect";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
import type { ClaudeProtocolObject } from "./claude-agent-sdk-ingress-schemas";
import {
  ClaudeTranscriptWorkerBatchError,
  createClaudeTranscriptWorkerPool,
  type ClaudeTranscriptWorkerPool,
} from "./claude-transcript-worker-pool";
import type {
  ClaudeTranscriptWorkerBatch,
  ClaudeTranscriptWorkerOptions,
} from "./claude-transcript-worker-protocol";

type ReadFailure = HostOperationError | AgentRuntimeQueryError;
export type ClaudeTranscriptSerialRecord = {
  write(bytes: Buffer): void;
  finish(end: number, trailing: boolean): Effect.Effect<ClaudeProtocolObject | null, ReadFailure>;
};
const READ_BYTES = 1024 * 1024;
const MAX_RECORD_BYTES = 2 * READ_BYTES;
const BUFFER_BYTES = MAX_RECORD_BYTES + READ_BYTES;
type Slot = { index: number; buffer: ArrayBuffer };
type Outcome = { ok: true; batch: ClaudeTranscriptWorkerBatch } | { ok: false; cause: unknown };
type Job = { slot: Slot; result: Promise<Outcome> };
type Frame =
  | { kind: "batch"; byteLength: number; firstLine: number }
  | { kind: "serial"; used: number; start: number; firstLine: number; newline: number };
const sourceError = (operation: string, path: string, cause: unknown) =>
  new HostOperationError({
    operation: `claude.transcript.${operation}`,
    message: `Cannot ${operation} Claude transcript '${path}': ${errorMessage(cause)}`,
    cause,
  });
const isHostOperationError = (cause: unknown): cause is HostOperationError =>
  cause instanceof HostOperationError && cause.details === undefined;

export const scanClaudeTranscriptInWorkers = (
  file: FileHandle,
  path: string,
  size: number,
  consume: (records: readonly ClaudeProtocolObject[]) => Effect.Effect<void, ReadFailure>,
  createSerialRecord: (start: number, line: number) => ClaudeTranscriptSerialRecord,
  options: ClaudeTranscriptWorkerOptions,
): Effect.Effect<void, ReadFailure> =>
  Effect.acquireUseRelease(
    createClaudeTranscriptWorkerPool(options),
    (pool) => scan(file, path, size, consume, createSerialRecord, pool),
    (pool) =>
      Effect.tryPromise({
        try: () => pool.close(),
        catch: (cause) => sourceError("close workers for", path, cause),
      }),
  );

const scan = (
  file: FileHandle,
  path: string,
  size: number,
  consume: (records: readonly ClaudeProtocolObject[]) => Effect.Effect<void, ReadFailure>,
  createSerialRecord: (start: number, line: number) => ClaudeTranscriptSerialRecord,
  pool: ClaudeTranscriptWorkerPool,
): Effect.Effect<void, ReadFailure> =>
  Effect.gen(function* () {
    const carry = Buffer.allocUnsafeSlow(MAX_RECORD_BYTES);
    const free: Slot[] = pool.slots.map((_, index) => {
      const buffer = Buffer.allocUnsafeSlow(BUFFER_BYTES);
      // SAFETY: allocUnsafeSlow creates an owned ArrayBuffer, not a shared backing.
      return { index, buffer: buffer.buffer as ArrayBuffer };
    });
    const active: Job[] = [];
    const firstLines = new Map<number, number>();
    let position = 0;
    let carryLength = 0;
    let line = 1;
    let exhausted = false;
    const read = (buffer: Buffer, offset: number) =>
      Effect.tryPromise({
        try: async () => {
          const { bytesRead } = await file.read(
            buffer,
            offset,
            Math.min(READ_BYTES, size - position, buffer.length - offset),
            position,
          );
          if (bytesRead === 0)
            throw new Error("The transcript changed during the read. Load the session again.");
          position += bytesRead;
          return bytesRead;
        },
        catch: (cause) => sourceError("read", path, cause),
      });
    const frame = (backing: ArrayBuffer): Effect.Effect<Frame | null, ReadFailure> =>
      Effect.gen(function* () {
        if (position === size && carryLength === 0) return null;
        const buffer = Buffer.from(backing);
        let used = carryLength;
        carry.copy(buffer, 0, 0, carryLength);
        carryLength = 0;
        const start = position - used;
        let scanFrom = 0;
        let firstNewline = -1;
        let lastNewline = -1;
        let lineCount = 0;
        while (true) {
          for (
            let index = buffer.indexOf(10, scanFrom);
            index >= 0 && index < used;
            index = buffer.indexOf(10, index + 1)
          ) {
            if (firstNewline < 0) firstNewline = index;
            lastNewline = index;
            lineCount++;
          }
          if (firstNewline > MAX_RECORD_BYTES || (firstNewline < 0 && used > MAX_RECORD_BYTES))
            return { kind: "serial", used, start, firstLine: line, newline: firstNewline };
          if (lastNewline >= 0 && (used >= READ_BYTES || position === size)) {
            const cut = lastNewline + 1;
            carryLength = used - cut;
            buffer.copy(carry, 0, cut, used);
            const firstLine = line;
            line += lineCount;
            return { kind: "batch", byteLength: cut, firstLine };
          }
          if (position === size)
            return { kind: "serial", used, start, firstLine: line, newline: -1 };
          scanFrom = used;
          used += yield* read(buffer, used);
        }
      });
    const consumeJob = (job: Job) =>
      Effect.gen(function* () {
        const outcome = yield* Effect.promise(() => job.result);
        if (!outcome.ok) {
          const cause = outcome.cause;
          if (
            isHostOperationError(cause) &&
            cause.cause instanceof ClaudeTranscriptWorkerBatchError
          ) {
            const failure = cause.cause;
            const firstLine = firstLines.get(failure.slotIndex)!;
            return yield* Effect.fail(
              sourceError("parse", `${path}:${firstLine + failure.lineIndex}`, failure),
            );
          }
          return yield* Effect.fail(
            isHostOperationError(cause) ? cause : sourceError("parse", path, cause),
          );
        }
        const { batch } = outcome;
        job.slot.buffer = batch.buffer;
        if (batch.records.length) yield* consume(batch.records);
        free.push(job.slot);
      });
    const drain = () =>
      Effect.gen(function* () {
        while (active.length) yield* consumeJob(active.shift()!);
      });
    const consumeSerial = (record: Extract<Frame, { kind: "serial" }>, slot: Slot) =>
      Effect.gen(function* () {
        yield* drain();
        const buffer = Buffer.from(slot.buffer);
        const reader = createSerialRecord(record.start, record.firstLine);
        let used = record.used;
        let newline = record.newline;
        while (true) {
          yield* Effect.try({
            try: () => reader.write(buffer.subarray(0, newline < 0 ? used : newline)),
            catch: (cause) => sourceError("parse", `${path}:${record.firstLine}`, cause),
          });
          if (newline >= 0 || position === size) {
            const end = position - used + (newline < 0 ? used : newline);
            const value = yield* reader.finish(end, newline < 0);
            if (value) yield* consume([value]);
            carryLength = newline < 0 ? 0 : used - newline - 1;
            if (carryLength) buffer.copy(carry, 0, newline + 1, used);
            line++;
            free.push(slot);
            return;
          }
          used = yield* read(buffer, 0);
          newline = buffer.indexOf(10, 0);
          if (newline >= used) newline = -1;
        }
      });
    while (!exhausted || active.length) {
      while (!exhausted && free.length) {
        const slot = free.shift()!;
        const next = yield* frame(slot.buffer);
        if (!next) {
          exhausted = true;
          break;
        }
        if (next.kind === "serial") {
          yield* consumeSerial(next, slot);
          continue;
        }
        firstLines.set(slot.index, next.firstLine);
        const result: Promise<Outcome> = pool.slots[slot.index]!.parse(
          slot.buffer,
          next.byteLength,
        ).then(
          (batch) => ({ ok: true, batch }),
          (cause: unknown) => ({ ok: false, cause }),
        );
        active.push({ slot, result });
      }
      if (active.length) yield* consumeJob(active.shift()!);
    }
  });
