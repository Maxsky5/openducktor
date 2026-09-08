import { beforeEach, afterEach, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Fiber } from "effect";
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

const originalOpen = fs.open;
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => fs.rm(path, { recursive: true, force: true })),
  );
});

test("a denied file open returns an actionable error without reading bytes", async () => {
  const directory = await fs.mkdtemp(join(tmpdir(), "odt-image-denied-"));
  directories.push(directory);
  const path = join(directory, "image.png");
  const denied = Object.assign(new Error("permission denied"), { code: "EACCES" });
  const spy = spyOn(fs, "open").mockImplementation(async (...args) => {
    if (args[0] === path) throw denied;
    return originalOpen(...args);
  });
  try {
    await expect(
      Effect.runPromise(
        createGeneratedImageFileAdapter(workers).read(
          { representation: "saved_file", path },
          "image",
        ),
      ),
    ).rejects.toThrow("readable");
    expect(spy.mock.calls.some(([opened]) => opened === path)).toBe(true);
  } finally {
    spy.mockRestore();
  }
});

for (const outcome of ["success", "growth", "failure", "interruption"] as const) {
  test(`closes the saved image handle on ${outcome}`, async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), "odt-image-resource-"));
    directories.push(directory);
    const path = join(directory, "image.png");
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=",
      "base64",
    );
    await fs.writeFile(path, bytes);
    let closes = 0;
    let markReading!: () => void;
    const reading = new Promise<void>((resolve) => {
      markReading = resolve;
    });
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const spy = spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        closes++;
        return close();
      };
      if (outcome === "growth") {
        const metadata = await handle.stat();
        await fs.appendFile(path, Buffer.from([0]));
        spyOn(handle, "stat").mockResolvedValue(metadata);
      }
      if (outcome === "failure")
        handle.read = async () => {
          throw new Error("read denied");
        };
      if (outcome === "interruption")
        handle.read = async () => {
          markReading();
          await readGate;
          throw new Error("cancelled read");
        };
      return handle;
    });
    try {
      const read = createGeneratedImageFileAdapter(workers).read(
        { representation: "saved_file", path },
        "image",
      );
      if (outcome === "interruption") {
        const fiber = Effect.runFork(read);
        await reading;
        await Effect.runPromise(Fiber.interrupt(fiber));
        releaseRead();
      } else if (outcome === "success") {
        expect((await Effect.runPromise(read)).byteLength).toBe(bytes.length);
      } else {
        await expect(Effect.runPromise(read)).rejects.toThrow(
          outcome === "growth" ? "grew during" : "could not be read",
        );
      }
      expect(closes).toBe(1);
    } finally {
      releaseRead();
      spy.mockRestore();
    }
  });
}
