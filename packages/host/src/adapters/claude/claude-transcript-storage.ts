import { Buffer } from "node:buffer";
import { chmod, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";

/** Append in sequence, then scan, then dispose. Appended JSON records transfer ownership. */
export type ClaudeTranscriptStorage<T> = {
  appendBatch(values: readonly T[]): Effect.Effect<void, HostOperationError>;
  scan(
    consume: (value: T, index: number) => Effect.Effect<void, HostOperationError>,
  ): Effect.Effect<void, HostOperationError>;
  dispose(): Effect.Effect<void, HostOperationError>;
};

const storageError = (cause: unknown, operation: string): HostOperationError =>
  new HostOperationError({
    operation: `claude.transcriptStorage.${operation}`,
    message: `Claude transcript storage could not ${operation}. Check access to the temporary directory.`,
    cause,
  });

const requireOpen = (disposed: boolean): Effect.Effect<void, HostOperationError> =>
  disposed
    ? Effect.fail(
        new HostOperationError({
          operation: "claude.transcriptStorage.closed",
          message: "Claude transcript storage is closed. Start a new transcript load.",
        }),
      )
    : Effect.void;

export const createMemoryClaudeTranscriptStorage = <T>(): ClaudeTranscriptStorage<T> => {
  const records: T[] = [];
  let disposed = false;
  return {
    appendBatch: (values) =>
      Effect.suspend(() => {
        if (disposed) return requireOpen(disposed);
        for (const value of values) records.push(value);
        return Effect.void;
      }),
    scan: (consume) =>
      Effect.gen(function* () {
        yield* requireOpen(disposed);
        for (const [index, value] of records.entries()) yield* consume(value, index);
      }),
    dispose: () =>
      Effect.sync(() => {
        records.length = 0;
        disposed = true;
      }),
  };
};

/** Acquire this storage with `Effect.acquireUseRelease` so each load removes its files. */
export const createDiskClaudeTranscriptStorage = <T>(): Effect.Effect<
  ClaudeTranscriptStorage<T>,
  HostOperationError
> =>
  Effect.gen(function* () {
    const directory = yield* Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), "openducktor-claude-transcript-")),
      catch: (cause) => storageError(cause, "create"),
    });
    const removeDirectory = Effect.tryPromise({
      try: () => rm(directory, { recursive: true, force: true }),
      catch: (cause) => storageError(cause, "remove"),
    });
    const file = yield* Effect.tryPromise({
      try: async () => {
        await chmod(directory, 0o700);
        return open(join(directory, "records.jsonl"), "wx+", 0o600);
      },
      catch: (cause) => storageError(cause, "create"),
    }).pipe(Effect.tapError(() => removeDirectory));
    let disposed = false;

    return {
      appendBatch: (values) =>
        Effect.gen(function* () {
          yield* requireOpen(disposed);
          if (values.length === 0) return;
          const serialized = yield* Effect.try({
            try: () => {
              const lines: string[] = [];
              for (const value of values) {
                const text = JSON.stringify(value);
                if (text === undefined)
                  throw new TypeError("Transcript records must be JSON values.");
                lines.push(text);
              }
              return `${lines.join("\n")}\n`;
            },
            catch: (cause) => storageError(cause, "encode"),
          });
          yield* Effect.tryPromise({
            try: () => file.appendFile(serialized, "utf8"),
            catch: (cause) => storageError(cause, "append"),
          });
        }),
      scan: (consume) =>
        Effect.gen(function* () {
          yield* requireOpen(disposed);
          const buffer = Buffer.allocUnsafe(64 * 1024);
          const decoder = new StringDecoder("utf8");
          let pending = "";
          let position = 0;
          let index = 0;
          while (true) {
            const { bytesRead } = yield* Effect.tryPromise({
              try: () => file.read(buffer, 0, buffer.length, position),
              catch: (cause) => storageError(cause, "read"),
            });
            if (bytesRead === 0) break;
            position += bytesRead;
            pending += decoder.write(buffer.subarray(0, bytesRead));
            let newline = pending.indexOf("\n");
            while (newline !== -1) {
              const line = pending.slice(0, newline);
              pending = pending.slice(newline + 1);
              const value = yield* Effect.try({
                // SAFETY: Only this storage writes these records. The caller validates T before append.
                try: () => JSON.parse(line) as T,
                catch: (cause) => storageError(cause, "decode"),
              });
              yield* consume(value, index++);
              newline = pending.indexOf("\n");
            }
          }
          pending += decoder.end();
          if (pending.length > 0) {
            return yield* Effect.fail(
              storageError(new Error("The temporary transcript record is incomplete."), "decode"),
            );
          }
        }),
      dispose: () =>
        Effect.gen(function* () {
          if (disposed) return;
          yield* Effect.acquireUseRelease(
            Effect.void,
            () =>
              Effect.tryPromise({
                try: () => file.close(),
                catch: (cause) => storageError(cause, "close"),
              }),
            () => removeDirectory,
          );
          disposed = true;
        }),
    } satisfies ClaudeTranscriptStorage<T>;
  }).pipe(Effect.uninterruptible);
