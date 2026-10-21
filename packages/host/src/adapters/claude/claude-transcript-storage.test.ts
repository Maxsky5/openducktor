import { expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import { dirname } from "node:path";
import { Effect, Result } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import {
  type ClaudeTranscriptStorage,
  createDiskClaudeTranscriptStorage,
  createMemoryClaudeTranscriptStorage,
} from "./claude-transcript-storage";

type Record = { uuid: string; content: { text: string }; order: number };

const backends: {
  name: string;
  create: () => Effect.Effect<ClaudeTranscriptStorage<Record>, HostOperationError>;
}[] = [
  { name: "memory", create: () => Effect.sync(createMemoryClaudeTranscriptStorage<Record>) },
  { name: "disk", create: createDiskClaudeTranscriptStorage<Record> },
];

for (const backend of backends) {
  test(`${backend.name} storage preserves records and source indexes across scans`, async () => {
    const records: [Record, Record, Record] = [
      { uuid: "same-id", content: { text: "first\nline" }, order: 1 },
      { uuid: "same-id", content: { text: "🦆".repeat(17_000) }, order: 2 },
      { uuid: "last-id", content: { text: "last" }, order: 3 },
    ];
    await Effect.runPromise(
      Effect.acquireUseRelease(
        backend.create(),
        (storage) =>
          Effect.gen(function* () {
            let emptyCount = 0;
            yield* storage.scan(() =>
              Effect.sync(() => {
                emptyCount += 1;
              }),
            );
            expect(emptyCount).toBe(0);
            yield* storage.appendBatch(records.slice(0, 2));
            yield* storage.appendBatch([]);
            yield* storage.appendBatch(records.slice(2));
            for (let scan = 0; scan < 2; scan += 1) {
              const actual: { value: Record; index: number }[] = [];
              yield* storage.scan((value, index) =>
                Effect.sync(() => {
                  actual.push({ value, index });
                }),
              );
              expect(actual).toEqual([
                { value: records[0], index: 0 },
                { value: records[1], index: 1 },
                { value: records[2], index: 2 },
              ]);
            }
          }),
        (storage) => storage.dispose(),
      ),
    );
  });

  test(`${backend.name} storage stops on a consumer failure and closes after the load`, async () => {
    const failure = new HostOperationError({ operation: "test.consume", message: "Stop scan." });
    let storage: ClaudeTranscriptStorage<Record> | undefined;
    const consumed: number[] = [];
    const result = await Effect.runPromise(
      Effect.result(
        Effect.acquireUseRelease(
          backend.create(),
          (created) =>
            Effect.gen(function* () {
              storage = created;
              yield* created.appendBatch([
                { uuid: "first", content: { text: "one" }, order: 1 },
                { uuid: "second", content: { text: "two" }, order: 2 },
              ]);
              yield* created.scan((_value, index) => {
                consumed.push(index);
                return Effect.fail(failure);
              });
            }),
          (created) => created.dispose(),
        ),
      ),
    );
    expect(Result.isFailure(result) && result.failure).toBe(failure);
    expect(consumed).toEqual([0]);
    if (!storage) throw new Error("Expected storage to open.");
    const closed = await Effect.runPromise(Effect.result(storage.scan(() => Effect.void)));
    expect(Result.isFailure(closed) && closed.failure.operation).toBe(
      "claude.transcriptStorage.closed",
    );
    const closedAppend = await Effect.runPromise(Effect.result(storage.appendBatch([])));
    expect(Result.isFailure(closedAppend) && closedAppend.failure.operation).toBe(
      "claude.transcriptStorage.closed",
    );
    await Effect.runPromise(storage.dispose());
  });
}

const openedTranscriptPath = (calls: readonly (readonly unknown[])[]): string => {
  const path = calls
    .map(([value]) => String(value))
    .find((value) => value.endsWith("records.jsonl"));
  if (!path) throw new Error("Expected a temporary transcript file.");
  return path;
};

test("disk storage rejects an invalid batch without writing its earlier records", async () => {
  await Effect.runPromise(
    Effect.acquireUseRelease(
      createDiskClaudeTranscriptStorage<Record | undefined>(),
      (storage) =>
        Effect.gen(function* () {
          const retained = { uuid: "retained", content: { text: "first" }, order: 1 };
          yield* storage.appendBatch([retained]);
          const result = yield* Effect.result(
            storage.appendBatch([
              { uuid: "invalid-batch", content: { text: "second" }, order: 2 },
              undefined,
            ]),
          );
          expect(Result.isFailure(result) && result.failure.operation).toBe(
            "claude.transcriptStorage.encode",
          );
          const actual: { value: Record | undefined; index: number }[] = [];
          yield* storage.scan((value, index) =>
            Effect.sync(() => {
              actual.push({ value, index });
            }),
          );
          expect(actual).toEqual([{ value: retained, index: 0 }]);
        }),
      (storage) => storage.dispose(),
    ),
  );
});

test("disk storage restricts temporary files and removes them after a decode failure", async () => {
  const openSpy = spyOn(fs, "open");
  let storage: ClaudeTranscriptStorage<Record> | undefined;
  let directory: string | undefined;
  try {
    const result = await Effect.runPromise(
      Effect.result(
        Effect.acquireUseRelease(
          createDiskClaudeTranscriptStorage<Record>(),
          (created) =>
            Effect.gen(function* () {
              storage = created;
              const path = openedTranscriptPath(openSpy.mock.calls);
              const tempDirectory = dirname(path);
              directory = tempDirectory;
              yield* created.appendBatch([
                { uuid: "one", content: { text: "retained" }, order: 1 },
              ]);
              if (process.platform !== "win32") {
                expect((yield* Effect.promise(() => fs.stat(tempDirectory))).mode & 0o777).toBe(
                  0o700,
                );
                expect((yield* Effect.promise(() => fs.stat(path))).mode & 0o777).toBe(0o600);
              }
              yield* Effect.promise(() => fs.writeFile(path, "{broken JSON}\n"));
              yield* created.scan(() => Effect.void);
            }),
          (created) => created.dispose(),
        ),
      ),
    );
    expect(Result.isFailure(result) && result.failure.operation).toBe(
      "claude.transcriptStorage.decode",
    );
    if (!directory) throw new Error("Expected a temporary transcript directory.");
    await expect(fs.access(directory)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    openSpy.mockRestore();
    if (storage) await Effect.runPromise(storage.dispose());
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
});

test("disk storage reports creation failures and removes the partial directory", async () => {
  const openFile = fs.open;
  const denied = new Error("Temporary file access denied.");
  const openSpy = spyOn(fs, "open").mockImplementation((path, flags, mode) => {
    if (String(path).endsWith("records.jsonl")) return Promise.reject(denied);
    return openFile(path, flags, mode);
  });
  let directory: string | undefined;
  try {
    const result = await Effect.runPromise(
      Effect.result(createDiskClaudeTranscriptStorage<Record>()),
    );
    directory = dirname(openedTranscriptPath(openSpy.mock.calls));
    expect(Result.isFailure(result) && result.failure).toMatchObject({
      operation: "claude.transcriptStorage.create",
      cause: denied,
    });
    await expect(fs.access(directory)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    openSpy.mockRestore();
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
});

test("disk storage reports cleanup failures", async () => {
  const storage = await Effect.runPromise(createDiskClaudeTranscriptStorage<Record>());
  const removeDirectory = fs.rm;
  const denied = new Error("Temporary directory removal denied.");
  const removeSpy = spyOn(fs, "rm").mockImplementation((path, options) => {
    if (String(path).includes("openducktor-claude-transcript-")) {
      return Promise.reject(denied);
    }
    return removeDirectory(path, options);
  });
  try {
    const result = await Effect.runPromise(Effect.result(storage.dispose()));
    expect(Result.isFailure(result) && result.failure).toMatchObject({
      operation: "claude.transcriptStorage.remove",
      cause: denied,
    });
  } finally {
    removeSpy.mockRestore();
    await Effect.runPromise(storage.dispose());
  }
});
