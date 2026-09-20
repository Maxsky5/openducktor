import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import { createWorkspaceFilesService } from "./workspace-files-service";
import {
  createFakeFilesystem,
  createFakeGitPort,
  hostOperationError,
} from "./test-support/workspace-files-service-fakes";

describe("createWorkspaceFilesService metadata concurrency", () => {
  test("bounds concurrent metadata reads and keeps sorted output", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const gate = yield* Deferred.make<void>();
          const started = yield* Deferred.make<void>();
          const files = Array.from(
            { length: 1000 },
            (_, index) => `file-${String(index).padStart(4, "0")}`,
          );
          let active = 0;
          let peak = 0;
          let calls = 0;
          const filesystem = createFakeFilesystem({ stats: { "/repo": { isDirectory: true } } });
          const service = createWorkspaceFilesService(
            {
              ...filesystem,
              stat: (path, options) =>
                Effect.gen(function* () {
                  calls += 1;
                  if (path === "/repo") return yield* filesystem.stat(path, options);
                  expect(options).toEqual({ followSymbolicLinks: false });
                  active += 1;
                  peak = Math.max(peak, active);
                  if (active === 4) yield* Deferred.succeed(started, undefined);
                  return yield* Effect.gen(function* () {
                    yield* Deferred.await(gate);
                    yield* Effect.yieldNow();
                    return { isDirectory: false, size: Number(path.slice(-4)), mtimeMs: 10 };
                  }).pipe(
                    Effect.ensuring(
                      Effect.sync(() => {
                        active -= 1;
                      }),
                    ),
                  );
                }),
            },
            createFakeGitPort({ files: [...files].reverse() }),
          );
          const fiber = yield* Effect.forkScoped(service.listTree({ rootPath: "/repo" }));
          yield* Deferred.await(started).pipe(
            Effect.timeoutFail({
              duration: "200 millis",
              onTimeout: () => new Error("Metadata reads did not reach the concurrency limit"),
            }),
          );
          expect(active).toBe(4);
          expect(calls).toBe(5);
          yield* Deferred.succeed(gate, undefined);
          const tree = yield* Fiber.join(fiber);
          expect(peak).toBe(4);
          expect(active).toBe(0);
          expect(calls).toBe(1001);
          expect(tree.entries.map((entry) => entry.path)).toEqual(files);
          expect(tree.entries.map((entry) => entry.size)).toEqual(files.map((_, index) => index));
        }),
      ),
    );
  });

  test("assembles directories, deleted files, and symlinks after out-of-order reads", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const lastRead = yield* Deferred.make<void>();
        const filesystem = createFakeFilesystem({
          stats: {
            "/repo": { isDirectory: true },
            "/repo/a.txt": { isDirectory: false, size: 1, mtimeMs: 2 },
            "/repo/nested/": { isDirectory: true },
          },
          linkStats: {
            "/repo/z-link": { isDirectory: false, isFile: false, size: 20, mtimeMs: 30 },
          },
        });
        const completed: string[] = [];
        const service = createWorkspaceFilesService(
          {
            ...filesystem,
            stat: (path, options) =>
              Effect.gen(function* () {
                if (path === "/repo/a.txt") yield* Deferred.await(lastRead);
                const metadata = yield* filesystem.stat(path, options);
                completed.push(path);
                if (path === "/repo/z-link") yield* Deferred.succeed(lastRead, undefined);
                return metadata;
              }),
          },
          createFakeGitPort({
            files: ["z-link", "nested/", "a.txt"],
            statuses: [
              { path: "gone/deleted.txt", status: "deleted", staged: false },
              { path: "nested/", status: "modified", staged: false },
            ],
          }),
        );
        const tree = yield* service.listTree({ rootPath: "/repo" }).pipe(
          Effect.timeoutFail({
            duration: "200 millis",
            onTimeout: () => new Error("Later metadata read did not progress"),
          }),
        );
        expect(completed.indexOf("/repo/z-link")).toBeLessThan(completed.indexOf("/repo/a.txt"));
        expect(tree.entries).toEqual([
          { path: "gone", kind: "directory", size: null, mtimeMs: null, gitStatus: null },
          { path: "nested", kind: "directory", size: null, mtimeMs: null, gitStatus: "modified" },
          { path: "a.txt", kind: "file", size: 1, mtimeMs: 2, gitStatus: null },
          {
            path: "gone/deleted.txt",
            kind: "file",
            size: null,
            mtimeMs: null,
            gitStatus: "deleted",
          },
          { path: "z-link", kind: "file", size: 20, mtimeMs: 30, gitStatus: null },
        ]);
      }),
    );
  });

  test("interrupts active metadata reads without starting queued paths", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const started = yield* Deferred.make<void>();
          let active = 0;
          let calls = 0;
          const filesystem = createFakeFilesystem({ stats: { "/repo": { isDirectory: true } } });
          const service = createWorkspaceFilesService(
            {
              ...filesystem,
              stat: (path, options) =>
                Effect.gen(function* () {
                  if (path === "/repo") return yield* filesystem.stat(path, options);
                  calls += 1;
                  active += 1;
                  if (active === 4) yield* Deferred.succeed(started, undefined);
                  return yield* Effect.never.pipe(
                    Effect.ensuring(
                      Effect.sync(() => {
                        active -= 1;
                      }),
                    ),
                  );
                }),
            },
            createFakeGitPort({
              files: Array.from({ length: 100 }, (_, index) => `file-${index}`),
            }),
          );
          const fiber = yield* Effect.forkScoped(service.listTree({ rootPath: "/repo" }));
          yield* Deferred.await(started).pipe(
            Effect.timeoutFail({
              duration: "200 millis",
              onTimeout: () => new Error("Metadata reads did not start"),
            }),
          );
          yield* Fiber.interrupt(fiber);
          expect(active).toBe(0);
          expect(calls).toBe(4);
        }),
      ),
    );
  });

  test.each([
    ["before later work starts", false],
    ["after later work starts", true],
  ])(
    "returns an early error without waiting for later reads: %s",
    async (_timing, waitForLaterRead) => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const laterStarted = yield* Deferred.make<void>();
          const blocked = yield* Deferred.make<void>();
          const cause = hostOperationError("first stat denied");
          const calls: string[] = [];
          let active = 0;
          let interrupted = 0;
          const filesystem = createFakeFilesystem({ stats: { "/repo": { isDirectory: true } } });
          const files = Array.from(
            { length: 100 },
            (_, index) => `file-${String(index).padStart(3, "0")}`,
          );
          const service = createWorkspaceFilesService(
            {
              ...filesystem,
              stat: (path, options) =>
                Effect.gen(function* () {
                  if (path === "/repo") return yield* filesystem.stat(path, options);
                  calls.push(path);
                  if (path === "/repo/file-000") {
                    if (waitForLaterRead) yield* Deferred.await(laterStarted);
                    return yield* Effect.fail(cause);
                  }
                  active += 1;
                  yield* Deferred.succeed(laterStarted, undefined);
                  return yield* Deferred.await(blocked).pipe(
                    Effect.as({ isDirectory: false }),
                    Effect.onInterrupt(() =>
                      Effect.sync(() => {
                        interrupted += 1;
                      }),
                    ),
                    Effect.ensuring(
                      Effect.sync(() => {
                        active -= 1;
                      }),
                    ),
                  );
                }),
            },
            createFakeGitPort({ files }),
          );
          const result = yield* Effect.either(service.listTree({ rootPath: "/repo" })).pipe(
            Effect.timeoutFail({
              duration: "200 millis",
              onTimeout: () => new Error("Known file error waited for a later blocked read"),
            }),
          );
          expect(result).toMatchObject({
            _tag: "Left",
            left: {
              _tag: "HostValidationError",
              message: "Unable to inspect file 'file-000'.",
              details: { rootPath: "/repo", relativePath: "file-000" },
              cause,
            },
          });
          expect(yield* Deferred.isDone(blocked)).toBe(false);
          expect(active).toBe(0);
          expect(calls.length).toBeLessThan(files.length);
          expect(interrupted).toBe(calls.length - 1);
          if (waitForLaterRead) expect(interrupted).toBeGreaterThan(0);
        }),
      );
    },
  );

  test("waits for earlier paths and skips deleted failures before returning a later error", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const earlier = yield* Deferred.make<void>();
          const lastStarted = yield* Deferred.make<void>();
          const cause = hostOperationError("later stat denied");
          let lastInterrupted = false;
          const filesystem = createFakeFilesystem({ stats: { "/repo": { isDirectory: true } } });
          const service = createWorkspaceFilesService(
            {
              ...filesystem,
              stat: (path, options) => {
                if (path === "/repo") return filesystem.stat(path, options);
                if (path === "/repo/a")
                  return Deferred.await(earlier).pipe(Effect.as({ isDirectory: false }));
                if (path === "/repo/b") return Effect.fail(hostOperationError("deleted file"));
                if (path === "/repo/c") return Effect.fail(cause);
                return Deferred.succeed(lastStarted, undefined).pipe(
                  Effect.zipRight(Effect.never),
                  Effect.onInterrupt(() =>
                    Effect.sync(() => {
                      lastInterrupted = true;
                    }),
                  ),
                );
              },
            },
            createFakeGitPort({
              files: ["d", "c", "b", "a"],
              statuses: [{ path: "b", status: "deleted", staged: false }],
            }),
          );
          const fiber = yield* Effect.forkScoped(
            Effect.either(service.listTree({ rootPath: "/repo" })),
          );
          yield* Deferred.await(lastStarted).pipe(
            Effect.timeoutFail({
              duration: "200 millis",
              onTimeout: () => new Error("Later metadata reads did not start"),
            }),
          );
          expect((yield* Fiber.poll(fiber))._tag).toBe("None");
          yield* Deferred.succeed(earlier, undefined);
          const result = yield* Fiber.join(fiber).pipe(
            Effect.timeoutFail({
              duration: "200 millis",
              onTimeout: () => new Error("Known error waited for a later blocked read"),
            }),
          );
          expect(result).toMatchObject({
            _tag: "Left",
            left: { _tag: "HostValidationError", message: "Unable to inspect file 'c'.", cause },
          });
          expect(lastInterrupted).toBe(true);
        }),
      ),
    );
  });

  test("reports the first path error even when a later stat fails first", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const laterFailed = yield* Deferred.make<void>();
          const firstCause = hostOperationError("first stat denied");
          const filesystem = createFakeFilesystem({ stats: { "/repo": { isDirectory: true } } });
          const service = createWorkspaceFilesService(
            {
              ...filesystem,
              stat: (path, options) => {
                if (path === "/repo") return filesystem.stat(path, options);
                if (path === "/repo/a")
                  return Deferred.await(laterFailed).pipe(Effect.zipRight(Effect.fail(firstCause)));
                return Deferred.succeed(laterFailed, undefined).pipe(
                  Effect.zipRight(Effect.fail(hostOperationError("later stat denied"))),
                );
              },
            },
            createFakeGitPort({ files: ["b", "a"] }),
          );
          const result = yield* Effect.either(service.listTree({ rootPath: "/repo" })).pipe(
            Effect.timeoutFail({
              duration: "200 millis",
              onTimeout: () => new Error("Independent stat did not progress"),
            }),
          );
          expect(result).toMatchObject({
            _tag: "Left",
            left: {
              _tag: "HostValidationError",
              message: "Unable to inspect file 'a'.",
              details: { rootPath: "/repo", relativePath: "a" },
              cause: firstCause,
            },
          });
        }),
      ),
    );
  });
});
