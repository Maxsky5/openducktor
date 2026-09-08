import { beforeEach, afterEach, expect, spyOn, test } from "bun:test";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Fiber, Exit, Cause } from "effect";
import { createGeneratedImageFileAdapter } from "./generated-image-file-adapter";
import {
  createGeneratedImageWorkers,
  type GeneratedImageWorkers,
} from "./generated-image-worker-client";

let workers: GeneratedImageWorkers;
beforeEach(async () => {
  workers = await Effect.runPromise(createGeneratedImageWorkers(() => Effect.void));
});
afterEach(async () => {
  await Effect.runPromise(workers.shutdown);
});

for (const cancel of [false, true]) {
  test.skipIf(process.platform === "win32")(
    `FIFO without a writer cannot block image ${cancel ? "cancellation" : "validation"}`,
    async () => {
      const directory = await fs.mkdtemp(join(tmpdir(), "odt-image-fifo-"));
      const path = join(directory, "image.png");
      const makeFifo = Bun.spawnSync(["mkfifo", path]);
      expect(makeFifo.exitCode).toBe(0);
      const originalOpen = fs.open;
      let markOpening!: () => void;
      const opening = new Promise<void>((resolve) => {
        markOpening = resolve;
      });
      let closes = 0;
      const spy = spyOn(fs, "open").mockImplementation(async (...args) => {
        markOpening();
        const handle = await originalOpen(...args);
        const close = handle.close.bind(handle);
        handle.close = async () => {
          closes++;
          return close();
        };
        return handle;
      });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const fiber = Effect.runFork(
        createGeneratedImageFileAdapter(workers).read(
          { representation: "saved_file", path },
          "fifo-image",
        ),
      );
      try {
        await opening;
        const completion = Effect.runPromise(cancel ? Fiber.interrupt(fiber) : Fiber.await(fiber));
        const result = await Promise.race([
          completion.then((exit) => ({ timedOut: false as const, exit })),
          new Promise<{ timedOut: true }>((resolve) => {
            timeout = setTimeout(() => resolve({ timedOut: true }), 500);
          }),
        ]);
        if (result.timedOut) {
          // Release the broken blocking acquisition so a failing regression leaves no file worker.
          const writer = await originalOpen(path, constants.O_WRONLY | constants.O_NONBLOCK);
          await writer.close();
          await completion;
        }
        expect(result.timedOut).toBe(false);
        if (!result.timedOut) {
          expect(Exit.isFailure(result.exit)).toBe(true);
          if (cancel && Exit.isFailure(result.exit))
            expect(Cause.isInterrupted(result.exit.cause)).toBe(true);
          if (!cancel && Exit.isFailure(result.exit)) {
            const error = Cause.failureOption(result.exit.cause);
            expect(error).toMatchObject({
              _tag: "Some",
              value: { _tag: "HostValidationError", field: "image" },
            });
            expect(Cause.pretty(result.exit.cause)).toContain("not a regular file");
          }
        }
        expect(closes).toBe(1);
      } finally {
        if (timeout) clearTimeout(timeout);
        spy.mockRestore();
        await fs.rm(directory, { recursive: true, force: true });
      }
    },
  );
}
