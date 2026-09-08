import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOCAL_ATTACHMENT_BYTE_LIMIT } from "@openducktor/contracts";
import { Cause, Effect, Exit, Fiber, Option } from "effect";
import { causeToHostBoundaryError } from "../../effect/host-errors";
import { createGeneratedImageFileAdapter } from "./generated-image-file-adapter";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=",
  "base64",
);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const imageFile = async (bytes = png) => {
  const directory = await mkdtemp(join(tmpdir(), "odt-generated-image-"));
  directories.push(directory);
  const path = join(directory, "image.png");
  await writeFile(path, bytes);
  return path;
};
const reader = createGeneratedImageFileAdapter();

test("saved and inline PNG output return the same bounded bytes", async () => {
  const path = await imageFile();
  const saved = await Effect.runPromise(
    reader.read({ representation: "saved_file", path }, "image"),
  );
  const inline = await Effect.runPromise(
    reader.read({ representation: "inline", base64: png.toString("base64") }, "image"),
  );
  expect(saved).toEqual(inline);
  expect(saved).toEqual({
    mime: "image/png",
    byteLength: png.byteLength,
    base64: png.toString("base64"),
  });
});

test("missing, directory, relative, and URL paths fail without file bytes", async () => {
  const path = await imageFile();
  for (const candidate of [
    path + ".missing",
    directories[0]!,
    "relative.png",
    "https://example.com/image.png",
    "/invalid\0path",
  ]) {
    await expect(
      Effect.runPromise(reader.read({ representation: "saved_file", path: candidate }, "image")),
    ).rejects.toThrow("Image 'image'");
  }
});

test("malformed base64 and non-PNG output fail without including payloads", async () => {
  for (const base64 of [
    "private-invalid-payload",
    "=AAA",
    "A===",
    "AB==",
    "AAB=",
    "AAAA\n",
    "",
    Buffer.from("not a PNG").toString("base64"),
    "R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==",
  ]) {
    const result = await Effect.runPromise(
      Effect.either(reader.read({ representation: "inline", base64 }, "image")),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.message).toContain("Image 'image'");
      expect(result.left.message).not.toContain("private-invalid-payload");
    }
  }
});

test("32 MiB is accepted and one extra decoded byte is rejected, including equal encoded lengths", async () => {
  const bytes = Buffer.alloc(LOCAL_ATTACHMENT_BYTE_LIMIT + 1);
  png.copy(bytes);
  const exact = bytes.subarray(0, LOCAL_ATTACHMENT_BYTE_LIMIT).toString("base64");
  const larger = bytes.toString("base64");
  expect(exact.length).toBe(larger.length);
  expect(
    (await Effect.runPromise(reader.read({ representation: "inline", base64: exact }, "image")))
      .byteLength,
  ).toBe(LOCAL_ATTACHMENT_BYTE_LIMIT);
  await expect(
    Effect.runPromise(reader.read({ representation: "inline", base64: larger }, "image")),
  ).rejects.toThrow("32 MiB");
  const path = await imageFile(bytes);
  await expect(
    Effect.runPromise(reader.read({ representation: "saved_file", path }, "image")),
  ).rejects.toThrow("32 MiB");
});

for (const readFails of [false, true]) {
  test(`close failure stays typed when reading ${readFails ? "fails" : "succeeds"}`, async () => {
    const path = await imageFile();
    const handle = await open(path, "r");
    const closeHandle = handle.close.bind(handle);
    const realOpen = fs.open;
    const openFile = spyOn(fs, "open").mockImplementation((...args) =>
      args[0] === path ? Promise.resolve(handle) : realOpen(...args),
    );
    const readFile = readFails
      ? spyOn(handle, "read").mockRejectedValue(new Error("read failed"))
      : undefined;
    const closeFile = spyOn(handle, "close").mockImplementation(async () => {
      await closeHandle();
      throw new Error("close failed");
    });
    try {
      const exit = await Effect.runPromiseExit(
        reader.read({ representation: "saved_file", path }, "image"),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (!Exit.isFailure(exit)) throw new Error("Expected an image read failure");
      const failures = [...Cause.failures(exit.cause)];
      expect(failures).toHaveLength(readFails ? 2 : 1);
      expect([...Cause.defects(exit.cause)]).toEqual([]);
      for (const failure of failures) {
        if (failure._tag !== "HostOperationError")
          throw new Error("Expected a typed operation error");
        expect(failure.operation).toBe("generated-image.read");
        expect(failure.details).toEqual({ itemId: "image" });
      }
      expect(failures.at(-1)?.message).toContain("could not be closed");
      expect(causeToHostBoundaryError(exit.cause)).toBe(failures[0]!);
      expect(failures[0]?.message).toContain(
        readFails ? "could not be read" : "could not be closed",
      );
      expect(closeFile).toHaveBeenCalledTimes(1);
    } finally {
      openFile.mockRestore();
      readFile?.mockRestore();
      closeFile.mockRestore();
      await closeHandle();
    }
  });
}

test("interruption waits for file cleanup and preserves its interruption cause", async () => {
  const path = await imageFile();
  const handle = await open(path, "r");
  const closeHandle = handle.close.bind(handle);
  const readStarted = Promise.withResolvers<void>();
  const readResult = Promise.withResolvers<never>();
  const closeStarted = Promise.withResolvers<void>();
  const closeResult = Promise.withResolvers<void>();
  const realOpen = fs.open;
  const openFile = spyOn(fs, "open").mockImplementation((...args) =>
    args[0] === path ? Promise.resolve(handle) : realOpen(...args),
  );
  const stat = spyOn(handle, "stat").mockImplementation(() => {
    readStarted.resolve();
    return readResult.promise;
  });
  const closeFile = spyOn(handle, "close").mockImplementation(async () => {
    closeStarted.resolve();
    await closeResult.promise;
    await closeHandle();
  });
  const fiber = Effect.runFork(reader.read({ representation: "saved_file", path }, "image"));
  try {
    await readStarted.promise;
    const otherPath = await imageFile();
    const other = await Effect.runPromise(
      reader.read({ representation: "saved_file", path: otherPath }, "other"),
    );
    expect(other.byteLength).toBe(png.byteLength);
    const interrupted = Effect.runPromise(Fiber.interrupt(fiber));
    await closeStarted.promise;
    expect(Option.isNone(await Effect.runPromise(Fiber.poll(fiber)))).toBe(true);
    closeResult.resolve();
    const exit = await interrupted;
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) throw new Error("Expected interruption");
    expect(Cause.isInterrupted(exit.cause)).toBe(true);
    expect([...Cause.defects(exit.cause)]).toEqual([]);
    expect(closeFile).toHaveBeenCalledTimes(1);
  } finally {
    readResult.reject(new Error("Read cancelled"));
    closeResult.resolve();
    await Effect.runPromise(Fiber.interrupt(fiber));
    openFile.mockRestore();
    stat.mockRestore();
    closeFile.mockRestore();
    await closeHandle();
  }
});
