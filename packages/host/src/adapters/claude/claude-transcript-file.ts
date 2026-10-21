import { Buffer } from "node:buffer";
import { constants, type BigIntStats } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { AgentRuntimeQueryError } from "@openducktor/core";
import { Effect } from "effect";
import { z } from "zod";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
import type { ClaudeProtocolObject } from "./claude-agent-sdk-ingress-schemas";
import {
  createClaudeTranscriptJsonReader,
  ClaudeTranscriptJsonError,
  type ClaudeTranscriptJsonReader,
} from "./claude-transcript-json";
import { scanClaudeTranscriptInWorkers } from "./claude-transcript-parallel-scan";

export const CLAUDE_TRANSCRIPT_MISSING_MESSAGE =
  "The selected Claude session is unavailable. Check its history on the host.";

type ReadFailure = HostOperationError | AgentRuntimeQueryError;
const fileErrorSchema = z.object({ code: z.string() });

const sourceError = (operation: string, path: string, cause: unknown) =>
  new HostOperationError({
    operation: `claude.transcript.${operation}`,
    message: `Cannot ${operation} Claude transcript '${path}': ${errorMessage(cause)}`,
    cause,
  });

const openTranscript = (path: string) =>
  Effect.tryPromise({
    try: async () => {
      const file = await open(
        path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
      );
      try {
        if (!(await file.stat()).isFile()) throw new Error("The transcript is not a regular file.");
        return file;
      } catch (cause) {
        await file.close();
        throw cause;
      }
    },
    catch: (cause) => {
      const parsed = fileErrorSchema.safeParse(cause);
      return parsed.success && parsed.data.code === "ENOENT"
        ? new AgentRuntimeQueryError("request_failed", CLAUDE_TRANSCRIPT_MISSING_MESSAGE)
        : sourceError("open", path, cause);
    },
  });

const fileFingerprint = (stat: BigIntStats): string =>
  [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");

const readFileStat = (file: FileHandle, path: string) =>
  Effect.tryPromise({
    try: () => file.stat({ bigint: true }),
    catch: (cause) => sourceError("stat", path, cause),
  });

const closeTranscript = (file: FileHandle, path: string): Effect.Effect<void, HostOperationError> =>
  Effect.tryPromise({
    try: () => file.close(),
    catch: (cause) => sourceError("close", path, cause),
  });

const finishRecord = (
  reader: ClaudeTranscriptJsonReader,
  decoder: StringDecoder,
  chunk: string,
  trailing: boolean,
): ReturnType<ClaudeTranscriptJsonReader["finish"]> => {
  if (chunk.length > 0) reader.write(chunk);
  const end = decoder.end();
  if (end.length > 0) reader.write(end);
  try {
    return reader.finish();
  } catch (cause) {
    if (trailing && cause instanceof ClaudeTranscriptJsonError && cause.reason === "incomplete")
      return { kind: "complete", record: null };
    throw cause;
  }
};

export const readClaudeTranscriptFingerprint = (path: string): Effect.Effect<string, ReadFailure> =>
  Effect.acquireUseRelease(
    openTranscript(path),
    (file) => readFileStat(file, path).pipe(Effect.map(fileFingerprint)),
    (file) => closeTranscript(file, path),
  );

export const scanClaudeTranscriptBatches = (
  path: string,
  consume: (records: readonly ClaudeProtocolObject[]) => Effect.Effect<void, ReadFailure>,
  options: {
    mode?: "history" | "scope" | "summary";
    range?: { tailBytes?: number; stopWhen?: () => boolean };
    onReadSnapshot?: (before: string, after: string) => void;
  } = {},
): Effect.Effect<void, ReadFailure> =>
  Effect.acquireUseRelease(
    openTranscript(path),
    (file) =>
      Effect.gen(function* () {
        const { range } = options;
        const metadataOnly = options.mode === "scope";
        const summaryOnly = options.mode === "summary";
        const stat = yield* readFileStat(file, path);
        const size = Number(stat.size);
        const decoder = new StringDecoder("utf8");
        let position = range?.tailBytes ? Math.max(0, size - range.tailBytes) : 0;
        let skipPartialLine = position > 0;
        let line = 1;
        let recordStart = position;
        let reader = createClaudeTranscriptJsonReader({ metadataOnly, summaryOnly });
        let hasRecord = false;
        type Entry = {
          pass: ReturnType<ClaudeTranscriptJsonReader["finish"]>;
          start: number;
          end: number;
          line: number;
        };
        const complete = (entry: Entry) =>
          Effect.gen(function* () {
            if (entry.pass.kind === "complete") return entry.pass.record;
            const replay = entry.pass.reader;
            const replayBuffer = Buffer.allocUnsafe(64 * 1024);
            const replayDecoder = new StringDecoder("utf8");
            let at = entry.start;
            while (at < entry.end) {
              const { bytesRead } = yield* Effect.tryPromise({
                try: () =>
                  file.read(replayBuffer, 0, Math.min(replayBuffer.length, entry.end - at), at),
                catch: (cause) => sourceError("replay", `${path}:${entry.line}`, cause),
              });
              if (bytesRead === 0)
                return yield* Effect.fail(
                  sourceError(
                    "replay",
                    `${path}:${entry.line}`,
                    new ClaudeTranscriptJsonError("changed"),
                  ),
                );
              at += bytesRead;
              yield* Effect.try({
                try: () => replay.write(replayDecoder.write(replayBuffer.subarray(0, bytesRead))),
                catch: (cause) => sourceError("parse", `${path}:${entry.line}`, cause),
              });
            }
            const result = yield* Effect.try({
              try: () => {
                replay.write(replayDecoder.end());
                return replay.finish();
              },
              catch: (cause) => sourceError("parse", `${path}:${entry.line}`, cause),
            });
            if (result.kind === "replay")
              return yield* Effect.fail(
                sourceError(
                  "parse",
                  `${path}:${entry.line}`,
                  new Error("A Claude transcript record requested more than two passes."),
                ),
              );
            return result.record;
          });
        if (size >= 32 * 1024 * 1024 && !range) {
          yield* scanClaudeTranscriptInWorkers(
            file,
            path,
            size,
            consume,
            (start, line) => {
              const decoder = new StringDecoder("utf8");
              const reader = createClaudeTranscriptJsonReader({ metadataOnly, summaryOnly });
              return {
                write: (bytes) => {
                  const text = decoder.write(bytes);
                  if (text.length > 0) reader.write(text);
                },
                finish: (end, trailing) =>
                  Effect.gen(function* () {
                    const pass = yield* Effect.try({
                      try: () => finishRecord(reader, decoder, "", trailing),
                      catch: (cause) => sourceError("parse", `${path}:${line}`, cause),
                    });
                    return yield* complete({ pass, start, end, line });
                  }),
              };
            },
            { metadataOnly, summaryOnly },
          );
          if (options.onReadSnapshot) {
            const after = yield* readFileStat(file, path);
            options.onReadSnapshot(fileFingerprint(stat), fileFingerprint(after));
          }
          return;
        }
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        while (position < size) {
          const { bytesRead } = yield* Effect.tryPromise({
            try: () => file.read(buffer, 0, Math.min(buffer.length, size - position), position),
            catch: (cause) => sourceError("read", path, cause),
          });
          if (bytesRead === 0)
            return yield* Effect.fail(
              sourceError(
                "read",
                path,
                new Error("The transcript changed during the read. Load the session again."),
              ),
            );
          const chunkStart = position;
          position += bytesRead;
          let start = 0;
          while (start < bytesRead) {
            const entries = yield* Effect.try({
              try: () => {
                const entries: Entry[] = [];
                for (
                  let index = buffer.indexOf(10, start);
                  index >= 0 && index < bytesRead;
                  index = buffer.indexOf(10, start)
                ) {
                  if (skipPartialLine) {
                    skipPartialLine = false;
                    start = index + 1;
                    recordStart = chunkStart + start;
                    continue;
                  }
                  const pass = finishRecord(
                    reader,
                    decoder,
                    decoder.write(buffer.subarray(start, index)),
                    false,
                  );
                  entries.push({ pass, start: recordStart, end: chunkStart + index, line });
                  reader = createClaudeTranscriptJsonReader({ metadataOnly, summaryOnly });
                  hasRecord = false;
                  line++;
                  start = index + 1;
                  recordStart = chunkStart + start;
                  if (range?.stopWhen) return entries;
                }
                if (!skipPartialLine && start < bytesRead) {
                  hasRecord = true;
                  reader.write(decoder.write(buffer.subarray(start, bytesRead)));
                }
                start = bytesRead;
                return entries;
              },
              catch: (cause) => sourceError("parse", `${path}:${line}`, cause),
            });
            const records: ClaudeProtocolObject[] = [];
            for (const entry of entries) {
              const record =
                entry.pass.kind === "complete" ? entry.pass.record : yield* complete(entry);
              if (record) records.push(record);
            }
            if (records.length > 0) yield* consume(records);
            if (range?.stopWhen?.()) return;
          }
        }
        if (hasRecord) {
          const pass = yield* Effect.try({
            try: () => finishRecord(reader, decoder, "", true),
            catch: (cause) => sourceError("parse", `${path}:${line}`, cause),
          });
          const record = yield* complete({ pass, start: recordStart, end: size, line });
          if (record) yield* consume([record]);
        }
        if (options.onReadSnapshot) {
          const after = yield* readFileStat(file, path);
          options.onReadSnapshot(fileFingerprint(stat), fileFingerprint(after));
        }
      }),
    (file) => closeTranscript(file, path),
  );

export const scanClaudeTranscript = (
  path: string,
  consume: (record: ClaudeProtocolObject) => Effect.Effect<void, ReadFailure>,
  options: Parameters<typeof scanClaudeTranscriptBatches>[2] = {},
): Effect.Effect<void, ReadFailure> =>
  scanClaudeTranscriptBatches(
    path,
    (records) =>
      Effect.gen(function* () {
        for (const record of records) yield* consume(record);
      }),
    options,
  );

export const readClaudeTranscriptSidecar = (path: string): Effect.Effect<string, ReadFailure> =>
  Effect.acquireUseRelease(
    openTranscript(path),
    (file) =>
      Effect.tryPromise({
        try: async () => {
          if ((await file.stat()).size > 64 * 1024)
            throw new Error("The subagent sidecar must be at most 64 KiB.");
          const buffer = Buffer.allocUnsafe(64 * 1024 + 1);
          let size = 0;
          while (size < buffer.length) {
            const { bytesRead } = await file.read(buffer, size, buffer.length - size, size);
            if (bytesRead === 0) return buffer.subarray(0, size).toString("utf8");
            size += bytesRead;
          }
          throw new Error("The subagent sidecar must be at most 64 KiB.");
        },
        catch: (cause) => sourceError("read sidecar", path, cause),
      }),
    (file) => closeTranscript(file, path),
  );
