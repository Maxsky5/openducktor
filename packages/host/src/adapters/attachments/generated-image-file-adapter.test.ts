import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOCAL_ATTACHMENT_BYTE_LIMIT } from "@openducktor/contracts";
import { Effect } from "effect";
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
