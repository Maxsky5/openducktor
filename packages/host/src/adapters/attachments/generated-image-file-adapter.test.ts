import { createHash } from "node:crypto";
import { beforeEach, afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, open, rm, truncate, writeFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOCAL_ATTACHMENT_BYTE_LIMIT } from "@openducktor/contracts";
import { Cause, Effect, Exit, Fiber } from "effect";
import { causeToHostBoundaryError } from "../../effect/host-errors";
import { createGeneratedImageFileAdapter } from "./generated-image-file-adapter";
import { decodeInlineImage } from "./generated-image-decode";
import { readSavedImage } from "./generated-image-saved-file";
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

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=";
const png = Buffer.from(pngBase64, "base64");
const pngRevision = createHash("sha256").update("saved_file\0").update(png).digest("hex");
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
let reader: ReturnType<typeof createGeneratedImageFileAdapter>;
beforeEach(() => {
  reader = createGeneratedImageFileAdapter(workers);
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
      Effect.runPromise(
        reader.read(
          {
            representation: "saved_file",
            revision: pngRevision,
            path: candidate,
          },
          "image",
        ),
      ),
    ).rejects.toThrow("Image 'image'");
  }
});

test.each([
  [
    "malformed base64",
    "private-invalid-payload!",
    "the runtime returned malformed base64 image data",
  ],
  ["a GIF", "R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "only PNG"],
])("rejects %s without exposing its payload", async (_input, base64, reason) => {
  const result = await Effect.runPromise(
    Effect.result(reader.read({ representation: "inline", base64 }, "image")),
  );
  if (result._tag !== "Failure") throw new Error("Expected an image validation failure");
  expect(result.failure).toMatchObject({
    _tag: "HostValidationError",
    field: "image",
    details: { itemId: "image", operation: "generated-image.read" },
  });
  expect(result.failure.message).toContain(`Image 'image' cannot be previewed: ${reason}`);
  expect(result.failure.message).not.toContain(base64);
});

test("32 MiB is accepted and one extra decoded byte is rejected, including equal encoded lengths", async () => {
  // Small images cover worker routing above; check the large limit at the decoder and file reader.
  const encodedLength = Math.ceil(LOCAL_ATTACHMENT_BYTE_LIMIT / 3) * 4;
  const prefix = "A".repeat(encodedLength - 4);
  const exact = `${prefix}AAA=`;
  const larger = `${prefix}AAAA`;
  expect(exact.length).toBe(larger.length);
  expect(decodeInlineImage(exact, "image").byteLength).toBe(LOCAL_ATTACHMENT_BYTE_LIMIT);
  expect(() => decodeInlineImage(larger, "image")).toThrow("32 MiB");

  const path = await imageFile();
  await truncate(path, LOCAL_ATTACHMENT_BYTE_LIMIT + 1);
  const oversizedFile = await Effect.runPromise(Effect.result(readSavedImage(path, "image")));
  expect(oversizedFile._tag).toBe("Failure");
  if (oversizedFile._tag === "Failure") expect(oversizedFile.failure.message).toContain("32 MiB");
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
        reader.read(
          {
            representation: "saved_file",
            revision: pngRevision,
            path,
          },
          "image",
        ),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (!Exit.isFailure(exit)) throw new Error("Expected an image read failure");
      const failures = exit.cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error);
      expect(failures).toHaveLength(readFails ? 2 : 1);
      expect(exit.cause.reasons.filter(Cause.isDieReason).map((reason) => reason.defect)).toEqual(
        [],
      );
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
  const fiber = Effect.runFork(
    reader.read(
      {
        representation: "saved_file",
        revision: pngRevision,
        path,
      },
      "image",
    ),
  );
  try {
    await readStarted.promise;
    const otherPath = await imageFile();
    const other = await Effect.runPromise(
      reader.read(
        {
          representation: "saved_file",
          revision: pngRevision,
          path: otherPath,
        },
        "other",
      ),
    );
    expect(other.byteLength).toBe(png.byteLength);
    const interrupted = Effect.runPromise(
      Fiber.interrupt(fiber).pipe(Effect.andThen(Fiber.await(fiber))),
    );
    await closeStarted.promise;
    expect(fiber.pollUnsafe()).toBeUndefined();
    closeResult.resolve();
    const exit = await interrupted;
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) throw new Error("Expected interruption");
    expect(Cause.hasInterrupts(exit.cause)).toBe(true);
    expect(exit.cause.reasons.filter(Cause.isDieReason).map((reason) => reason.defect)).toEqual([]);
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

test("previews the described PNG and refuses a saved file that changes before preview", async () => {
  const path = await imageFile();
  const preparation = [
    {
      item: {
        type: "imageGeneration" as const,
        id: "saved",
        status: "completed",
        result: "ignored-inline",
        revisedPrompt: null,
        failure: null,
        savedPath: path,
      },
      context: { turnId: "turn" },
    },
  ];
  const [first] = await workers.prepareHistory(preparation, undefined, "preview");
  expect(first?.status).toBe("completed");
  expect(first?.output?.revision).toBe(pngRevision);
  const savedSource = {
    representation: "saved_file",
    path,
    revision: first!.output!.revision,
  } as const;
  const saved = await Effect.runPromise(reader.read(savedSource, "saved"));
  const inline = await Effect.runPromise(
    reader.read({ representation: "inline", base64: pngBase64 }, "inline"),
  );
  expect(saved).toEqual({ mime: "image/png", byteLength: png.byteLength, base64: pngBase64 });
  expect(inline).toEqual(saved);

  const changed = Buffer.from(png);
  changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
  await writeFile(path, changed);
  await expect(Effect.runPromise(reader.read(savedSource, "saved"))).rejects.toThrow("changed");
  const [second] = await workers.prepareHistory(preparation, undefined, "preview");
  expect(second?.output?.revision).not.toBe(first?.output?.revision);
  const payload = await Effect.runPromise(
    reader.read(
      { representation: "saved_file", path, revision: second!.output!.revision },
      "saved",
    ),
  );
  expect(payload.base64).toBe(changed.toString("base64"));
  await rm(path);
  const [missing] = await workers.prepareHistory(preparation, undefined, "preview");
  expect(missing).toMatchObject({
    status: "completed",
    previewUnavailableReason: expect.stringContaining("readable"),
  });
  expect(missing?.output).toBeUndefined();
});

test("saved file history metadata does not open files", async () => {
  const openFile = spyOn(fs, "open");
  try {
    const parts = await workers.prepareHistory(
      Array.from({ length: 80 }, (_, index) => ({
        item: {
          type: "imageGeneration" as const,
          id: `saved-${index}`,
          status: "completed",
          result: "ignored",
          revisedPrompt: null,
          failure: null,
          savedPath: "/missing/image.png",
        },
        context: { turnId: "turn" },
      })),
    );
    expect(openFile).not.toHaveBeenCalled();
    expect(parts).toHaveLength(80);
    expect(
      parts.every(
        (part) =>
          part.status === "completed" &&
          part.output === undefined &&
          part.previewUnavailableReason === undefined,
      ),
    ).toBe(true);
  } finally {
    openFile.mockRestore();
  }
});
