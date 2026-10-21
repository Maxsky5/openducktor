import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LOCAL_IMAGE_MAX_BYTES } from "@openducktor/contracts";
import { Effect } from "effect";
import { createLocalAttachmentAdapter } from "../../adapters/attachments/local-attachment-adapter";
import { readLocalImage } from "./local-image-reader";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

const tempFolder = async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "odt-local-image-"));
  folders.push(folder);
  return folder;
};

const read = (file: string) =>
  Effect.runPromise(readLocalImage(createLocalAttachmentAdapter(), { path: file }));

describe("readLocalImage", () => {
  test("reads an image anywhere on the host, such as an agent screenshot in a temp folder", async () => {
    const file = path.join(await tempFolder(), "Shot.PNG");
    await writeFile(file, PNG);

    expect(await read(file)).toEqual({
      mediaType: "image/png",
      bytesBase64: Buffer.from(PNG).toString("base64"),
    });
  });

  test("refuses a path that is not an absolute path to a small image file", async () => {
    const folder = await tempFolder();
    const notes = path.join(folder, "notes.txt");
    await writeFile(notes, "hello");
    const folderNamedLikeImage = path.join(folder, "album.png");
    await mkdir(folderNamedLikeImage);
    const large = path.join(folder, "large.png");
    await writeFile(large, PNG);
    await truncate(large, LOCAL_IMAGE_MAX_BYTES + 1);

    await expect(read("shot.png")).rejects.toThrow("Use an absolute path to show the image");
    await expect(read(notes)).rejects.toThrow("is not a PNG, JPEG, GIF, or WebP image.");
    await expect(read(folderNamedLikeImage)).rejects.toThrow("is not a file.");
    await expect(read(large)).rejects.toThrow("is larger than 20 MB");
    await expect(read(path.join(folder, "missing.png"))).rejects.toThrow();
  });
});
