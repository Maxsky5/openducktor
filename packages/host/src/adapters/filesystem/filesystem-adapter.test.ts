import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { FilesystemFileOperationError } from "../../ports/filesystem-port";
import { createFilesystemAdapter } from "./filesystem-adapter";

const tempDirectories: string[] = [];
const encoder = new TextEncoder();

const createTempFile = async (contents: Uint8Array): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), "openducktor-file-write-"));
  tempDirectories.push(directory);
  const filePath = path.join(directory, "file.txt");
  await writeFile(filePath, contents);
  return realpath(filePath);
};

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("createFilesystemAdapter file snapshots", () => {
  test("replaces exact bytes on the existing file and preserves its mode", async () => {
    const filePath = await createTempFile(encoder.encode("longer original"));
    await chmod(filePath, 0o640);
    const filesystem = createFilesystemAdapter();
    const original = await Effect.runPromise(filesystem.readFileSnapshot(filePath, 1024));
    const originalMetadata = await stat(filePath);

    const saved = await Effect.runPromise(
      filesystem.replaceFileBytes({
        canonicalRootPath: path.dirname(filePath),
        path: filePath,
        expectedRevision: original.revision,
        bytes: encoder.encode("short"),
        maxCurrentBytes: 1024,
      }),
    );

    expect(await readFile(filePath, "utf8")).toBe("short");
    expect(saved.bytes).toEqual(encoder.encode("short"));
    expect(saved.revision).not.toBe(original.revision);
    const savedMetadata = await stat(filePath);
    expect(savedMetadata.mode & 0o777).toBe(0o640);
    expect(savedMetadata.ino).toBe(originalMetadata.ino);
  });

  test("supports empty and longer replacements", async () => {
    const filePath = await createTempFile(encoder.encode("a"));
    const filesystem = createFilesystemAdapter();
    const first = await Effect.runPromise(filesystem.readFileSnapshot(filePath, 1024));
    const empty = await Effect.runPromise(
      filesystem.replaceFileBytes({
        canonicalRootPath: path.dirname(filePath),
        path: filePath,
        expectedRevision: first.revision,
        bytes: new Uint8Array(),
        maxCurrentBytes: 1024,
      }),
    );
    await Effect.runPromise(
      filesystem.replaceFileBytes({
        canonicalRootPath: path.dirname(filePath),
        path: filePath,
        expectedRevision: empty.revision,
        bytes: encoder.encode("a longer replacement"),
        maxCurrentBytes: 1024,
      }),
    );
    expect(await readFile(filePath, "utf8")).toBe("a longer replacement");
  });

  test("rejects a stale revision without changing the file", async () => {
    const filePath = await createTempFile(encoder.encode("current"));
    const filesystem = createFilesystemAdapter();

    const exit = await Effect.runPromiseExit(
      filesystem.replaceFileBytes({
        canonicalRootPath: path.dirname(filePath),
        path: filePath,
        expectedRevision: "sha256:stale",
        bytes: encoder.encode("draft"),
        maxCurrentBytes: 1024,
      }),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = exit.cause._tag === "Fail" ? exit.cause.error : null;
      expect(failure).toBeInstanceOf(FilesystemFileOperationError);
      expect(failure).toMatchObject({ code: "stale_revision" });
    }
    expect(await readFile(filePath, "utf8")).toBe("current");
  });

  test("rejects a same-content file replacement", async () => {
    const filePath = await createTempFile(encoder.encode("same contents"));
    const movedPath = `${filePath}.original`;
    const filesystem = createFilesystemAdapter();
    const original = await Effect.runPromise(filesystem.readFileSnapshot(filePath, 1024));
    await rename(filePath, movedPath);
    await writeFile(filePath, "same contents");

    const exit = await Effect.runPromiseExit(
      filesystem.replaceFileBytes({
        canonicalRootPath: path.dirname(filePath),
        path: filePath,
        expectedRevision: original.revision,
        bytes: encoder.encode("draft"),
        maxCurrentBytes: 1024,
      }),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = exit.cause._tag === "Fail" ? exit.cause.error : null;
      expect(failure).toMatchObject({ code: "stale_revision" });
    }
    expect(await readFile(filePath, "utf8")).toBe("same contents");
    expect(await readFile(movedPath, "utf8")).toBe("same contents");
  });

  test("rejects a same-content symbolic-link swap without changing either target", async () => {
    const filePath = await createTempFile(encoder.encode("same contents"));
    const movedPath = `${filePath}.original`;
    const outsidePath = `${filePath}.outside`;
    const filesystem = createFilesystemAdapter();
    const original = await Effect.runPromise(filesystem.readFileSnapshot(filePath, 1024));
    await writeFile(outsidePath, "same contents");
    await rename(filePath, movedPath);
    await symlink(outsidePath, filePath);

    const exit = await Effect.runPromiseExit(
      filesystem.replaceFileBytes({
        canonicalRootPath: path.dirname(filePath),
        path: filePath,
        expectedRevision: original.revision,
        bytes: encoder.encode("draft"),
        maxCurrentBytes: 1024,
      }),
    );

    expect(exit._tag).toBe("Failure");
    expect(await readFile(outsidePath, "utf8")).toBe("same contents");
    expect(await readFile(movedPath, "utf8")).toBe("same contents");
  });

  test("rejects a parent-directory pivot to the original file outside the workspace", async () => {
    const rootDirectory = await mkdtemp(path.join(tmpdir(), "openducktor-file-write-root-"));
    const outsideDirectory = await mkdtemp(path.join(tmpdir(), "openducktor-file-write-outside-"));
    tempDirectories.push(rootDirectory, outsideDirectory);
    const rootPath = await realpath(rootDirectory);
    const outsideRoot = await realpath(outsideDirectory);
    const parentPath = path.join(rootPath, "nested");
    const movedParentPath = path.join(outsideRoot, "nested");
    const filePath = path.join(parentPath, "file.txt");
    await mkdir(parentPath);
    await writeFile(filePath, "same contents");
    const filesystem = createFilesystemAdapter();
    const original = await Effect.runPromise(filesystem.readFileSnapshot(filePath, 1024));
    await rename(parentPath, movedParentPath);
    await symlink(movedParentPath, parentPath);

    const exit = await Effect.runPromiseExit(
      filesystem.replaceFileBytes({
        canonicalRootPath: rootPath,
        path: filePath,
        expectedRevision: original.revision,
        bytes: encoder.encode("draft"),
        maxCurrentBytes: 1024,
      }),
    );

    expect(exit._tag).toBe("Failure");
    expect(await readFile(path.join(movedParentPath, "file.txt"), "utf8")).toBe("same contents");
  });

  test("rejects an oversized current file without changing it", async () => {
    const bytes = new Uint8Array(17).fill(0x61);
    const filePath = await createTempFile(bytes);
    const filesystem = createFilesystemAdapter();

    const exit = await Effect.runPromiseExit(
      filesystem.replaceFileBytes({
        canonicalRootPath: path.dirname(filePath),
        path: filePath,
        expectedRevision: "not-used",
        bytes: encoder.encode("draft"),
        maxCurrentBytes: 16,
      }),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = exit.cause._tag === "Fail" ? exit.cause.error : null;
      expect(failure).toMatchObject({ code: "too_large" });
    }
    expect(new Uint8Array(await readFile(filePath))).toEqual(bytes);
  });

  test("reports a missing target as unavailable", async () => {
    const tempDirectory = await mkdtemp(path.join(tmpdir(), "openducktor-file-write-"));
    tempDirectories.push(tempDirectory);
    const directory = await realpath(tempDirectory);
    const filesystem = createFilesystemAdapter();

    const exit = await Effect.runPromiseExit(
      filesystem.replaceFileBytes({
        canonicalRootPath: directory,
        path: path.join(directory, "missing.txt"),
        expectedRevision: "revision",
        bytes: encoder.encode("draft"),
        maxCurrentBytes: 1024,
      }),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = exit.cause._tag === "Fail" ? exit.cause.error : null;
      expect(failure).toMatchObject({ code: "unavailable_file" });
    }
  });

  test("reports a directory target as unavailable", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "openducktor-file-write-"));
    tempDirectories.push(directory);
    const filesystem = createFilesystemAdapter();

    const exit = await Effect.runPromiseExit(filesystem.readFileSnapshot(directory, 1024));

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = exit.cause._tag === "Fail" ? exit.cause.error : null;
      expect(failure).toMatchObject({ code: "unavailable_file" });
    }
  });
});
