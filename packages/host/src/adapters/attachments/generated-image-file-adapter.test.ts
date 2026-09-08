import { createHash } from "node:crypto";
import { beforeEach, afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOCAL_ATTACHMENT_BYTE_LIMIT } from "@openducktor/contracts";
import { Cause, Effect, Exit, Fiber, Option } from "effect";
import { causeToHostBoundaryError } from "../../effect/host-errors";
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
let reader: ReturnType<typeof createGeneratedImageFileAdapter>;
beforeEach(() => {
  reader = createGeneratedImageFileAdapter(workers);
});

test("saved and inline PNG output return the same bounded bytes", async () => {
  const path = await imageFile();
  const saved = await Effect.runPromise(
    reader.read(
      {
        representation: "saved_file",
        revision: createHash("sha256")
          .update("saved_file\0")
          .update(
            Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=",
              "base64",
            ),
          )
          .digest("hex"),
        path,
      },
      "image",
    ),
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
      Effect.runPromise(
        reader.read(
          {
            representation: "saved_file",
            revision: createHash("sha256")
              .update("saved_file\0")
              .update(
                Buffer.from(
                  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=",
                  "base64",
                ),
              )
              .digest("hex"),
            path: candidate,
          },
          "image",
        ),
      ),
    ).rejects.toThrow("Image 'image'");
  }
});

for (const [name, base64] of [
  ["invalid characters", "private-invalid-payload"],
  ["leading padding", "=AAA"],
  ["excess padding", "A==="],
  ["nonzero bits before double padding", "AB=="],
  ["nonzero bits before single padding", "AAB="],
  ["a trailing newline", "AAAA\n"],
  ["empty output", ""],
  ["plain text bytes", Buffer.from("not a PNG").toString("base64")],
  ["GIF bytes", "R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=="],
] as const) {
  test(`${name} fails without including image payloads`, async () => {
    const result = await Effect.runPromise(
      Effect.either(reader.read({ representation: "inline", base64 }, "image")),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.message).toContain("Image 'image'");
      expect(result.left.message).not.toContain("private-invalid-payload");
    }
  });
}

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
  const oversizedInline = await Effect.runPromise(
    Effect.either(reader.read({ representation: "inline", base64: larger }, "image")),
  );
  expect(oversizedInline._tag).toBe("Left");
  if (oversizedInline._tag === "Left") expect(oversizedInline.left.message).toContain("32 MiB");
  const path = await imageFile(bytes);
  const oversizedFile = await Effect.runPromise(
    Effect.either(
      reader.read(
        {
          representation: "saved_file",
          revision: createHash("sha256")
            .update("saved_file\0")
            .update(
              Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=",
                "base64",
              ),
            )
            .digest("hex"),
          path,
        },
        "image",
      ),
    ),
  );
  expect(oversizedFile._tag).toBe("Left");
  if (oversizedFile._tag === "Left") expect(oversizedFile.left.message).toContain("32 MiB");
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
            revision: createHash("sha256")
              .update("saved_file\0")
              .update(
                Buffer.from(
                  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=",
                  "base64",
                ),
              )
              .digest("hex"),
            path,
          },
          "image",
        ),
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
  const fiber = Effect.runFork(
    reader.read(
      {
        representation: "saved_file",
        revision: createHash("sha256")
          .update("saved_file\0")
          .update(
            Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=",
              "base64",
            ),
          )
          .digest("hex"),
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
          revision: createHash("sha256")
            .update("saved_file\0")
            .update(
              Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=",
                "base64",
              ),
            )
            .digest("hex"),
          path: otherPath,
        },
        "other",
      ),
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

test("saved file revisions follow bytes and reject replacement between metadata and preview", async () => {
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
  const [first] = await workers.prepareHistory(preparation);
  expect(first?.status).toBe("completed");
  expect(first?.output?.revision).toBe(
    createHash("sha256").update("saved_file\0").update(png).digest("hex"),
  );
  const changed = Buffer.from(png);
  changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
  await writeFile(path, changed);
  await expect(
    Effect.runPromise(
      reader.read(
        { representation: "saved_file", path, revision: first!.output!.revision },
        "saved",
      ),
    ),
  ).rejects.toThrow("changed");
  const [second] = await workers.prepareHistory(preparation);
  expect(second?.output?.revision).not.toBe(first?.output?.revision);
  const payload = await Effect.runPromise(
    reader.read(
      { representation: "saved_file", path, revision: second!.output!.revision },
      "saved",
    ),
  );
  expect(payload.base64).toBe(changed.toString("base64"));
  await rm(path);
  const [missing] = await workers.prepareHistory(preparation);
  expect(missing).toMatchObject({
    status: "completed",
    previewUnavailableReason: expect.stringContaining("readable"),
  });
  expect(missing?.output).toBeUndefined();
});
