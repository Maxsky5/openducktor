import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { createFilesystemAdapter } from "../../adapters/filesystem/filesystem-adapter";
import { FilesystemFileOperationError } from "../../ports/filesystem-port";
import type { GitPort } from "../../ports/git-port";
import { WorkspaceFileAccessError } from "./workspace-file-access";
import {
  createWorkspaceTextFileService,
  MAX_WORKSPACE_TEXT_FILE_BYTES,
} from "./workspace-text-file-service";

const tempDirectories: string[] = [];

const createRoot = async (): Promise<string> => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "openducktor-text-service-"));
  tempDirectories.push(rootPath);
  return rootPath;
};

const createGitPort = (files: string[]): GitPort =>
  ({
    isGitRepository: () => Effect.succeed(true),
    listFiles: () => Effect.succeed(files),
  }) as unknown as GitPort;

const writeError = async (
  effect: ReturnType<ReturnType<typeof createWorkspaceTextFileService>["writeTextFile"]>,
) => {
  const exit = await Effect.runPromiseExit(effect);
  expect(exit._tag).toBe("Failure");
  if (exit._tag !== "Failure" || exit.cause._tag !== "Fail") {
    throw new Error("Expected a typed workspace text file write failure.");
  }
  return exit.cause.error;
};

const writeFailure = async (
  effect: ReturnType<ReturnType<typeof createWorkspaceTextFileService>["writeTextFile"]>,
) => (await writeError(effect)).failure;

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("createWorkspaceTextFileService", () => {
  test("reads a revision and returns a new authoritative revision after an exact save", async () => {
    const rootPath = await createRoot();
    const filePath = path.join(rootPath, "file.txt");
    await writeFile(filePath, "before");
    const service = createWorkspaceTextFileService(
      createFilesystemAdapter(),
      createGitPort(["file.txt"]),
    );
    const loaded = await Effect.runPromise(
      service.readTextFile({ rootPath, relativePath: "file.txt" }),
    );
    if (loaded.kind !== "text") throw new Error("Expected text.");

    const saved = await Effect.runPromise(
      service.writeTextFile({
        rootPath,
        relativePath: "file.txt",
        contents: "after\n",
        revision: loaded.revision,
      }),
    );

    expect(await readFile(filePath, "utf8")).toBe("after\n");
    expect(saved).toMatchObject({ contents: "after\n", size: 6 });
    expect(saved.revision).not.toBe(loaded.revision);
  });

  test("preserves a UTF-8 BOM when saving edited contents", async () => {
    const rootPath = await createRoot();
    const filePath = path.join(rootPath, "file.txt");
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    await writeFile(filePath, new Uint8Array([...bom, ...new TextEncoder().encode("before")]));
    const service = createWorkspaceTextFileService(
      createFilesystemAdapter(),
      createGitPort(["file.txt"]),
    );
    const loaded = await Effect.runPromise(
      service.readTextFile({ rootPath, relativePath: "file.txt" }),
    );
    if (loaded.kind !== "text") throw new Error("Expected text.");

    const saved = await Effect.runPromise(
      service.writeTextFile({
        rootPath,
        relativePath: "file.txt",
        contents: loaded.contents.replace("before", "after"),
        revision: loaded.revision,
      }),
    );

    expect(new Uint8Array(await readFile(filePath))).toEqual(
      new Uint8Array([...bom, ...new TextEncoder().encode("after")]),
    );
    expect(saved.contents).toBe("\ufeffafter");
  });

  test("accepts an exact one MiB draft", async () => {
    const rootPath = await createRoot();
    await writeFile(path.join(rootPath, "file.txt"), "before");
    const service = createWorkspaceTextFileService(
      createFilesystemAdapter(),
      createGitPort(["file.txt"]),
    );
    const loaded = await Effect.runPromise(
      service.readTextFile({ rootPath, relativePath: "file.txt" }),
    );
    if (loaded.kind !== "text") throw new Error("Expected text.");
    const contents = "a".repeat(MAX_WORKSPACE_TEXT_FILE_BYTES);

    const saved = await Effect.runPromise(
      service.writeTextFile({
        rootPath,
        relativePath: "file.txt",
        contents,
        revision: loaded.revision,
      }),
    );

    expect(saved.size).toBe(MAX_WORKSPACE_TEXT_FILE_BYTES);
  });

  test("rejects a stale revision and keeps an external edit", async () => {
    const rootPath = await createRoot();
    const filePath = path.join(rootPath, "file.txt");
    await writeFile(filePath, "before");
    const service = createWorkspaceTextFileService(
      createFilesystemAdapter(),
      createGitPort(["file.txt"]),
    );
    const loaded = await Effect.runPromise(
      service.readTextFile({ rootPath, relativePath: "file.txt" }),
    );
    if (loaded.kind !== "text") throw new Error("Expected text.");
    await writeFile(filePath, "external");

    const failure = await writeFailure(
      service.writeTextFile({
        rootPath,
        relativePath: "file.txt",
        contents: "draft",
        revision: loaded.revision,
      }),
    );

    expect(failure.code).toBe("stale_revision");
    expect(await readFile(filePath, "utf8")).toBe("external");
  });

  test("rejects same-content regular-file and symbolic-link swaps at final validation", async () => {
    for (const swapType of ["regular", "symlink"] as const) {
      const rootPath = await createRoot();
      const outsideRoot = await createRoot();
      const filePath = path.join(rootPath, "file.txt");
      const originalPath = path.join(rootPath, "original.txt");
      const outsidePath = path.join(outsideRoot, "outside.txt");
      await writeFile(filePath, "same contents");
      await writeFile(outsidePath, "same contents");
      const filesystem = createFilesystemAdapter();
      const service = createWorkspaceTextFileService(
        {
          ...filesystem,
          replaceFileBytes: (input) =>
            Effect.gen(function* () {
              yield* Effect.tryPromise({
                try: async () => {
                  await rename(filePath, originalPath);
                  if (swapType === "regular") {
                    await writeFile(filePath, "same contents");
                  } else {
                    await symlink(outsidePath, filePath);
                  }
                },
                catch: (cause) =>
                  new FilesystemFileOperationError({
                    code: "io_failure",
                    operation: "replace",
                    path: filePath,
                    message: "Failed to prepare the commit race fixture.",
                    cause,
                  }),
              });
              return yield* filesystem.replaceFileBytes(input);
            }),
        },
        createGitPort(["file.txt"]),
      );
      const loaded = await Effect.runPromise(
        service.readTextFile({ rootPath, relativePath: "file.txt" }),
      );
      if (loaded.kind !== "text") throw new Error("Expected text.");

      const failure = await writeFailure(
        service.writeTextFile({
          rootPath,
          relativePath: "file.txt",
          contents: "draft",
          revision: loaded.revision,
        }),
      );

      expect(["stale_revision", "unavailable_file"]).toContain(failure.code);
      expect(await readFile(originalPath, "utf8")).toBe("same contents");
      if (swapType === "regular") {
        expect(await readFile(filePath, "utf8")).toBe("same contents");
      } else {
        expect(await readFile(outsidePath, "utf8")).toBe("same contents");
      }
    }
  });

  test("rejects a parent-directory pivot to the original file at final validation", async () => {
    const rootPath = await createRoot();
    const outsideRoot = await createRoot();
    const parentPath = path.join(rootPath, "nested");
    const movedParentPath = path.join(outsideRoot, "nested");
    const filePath = path.join(parentPath, "file.txt");
    await mkdir(parentPath);
    await writeFile(filePath, "same contents");
    const filesystem = createFilesystemAdapter();
    const service = createWorkspaceTextFileService(
      {
        ...filesystem,
        replaceFileBytes: (input) =>
          Effect.gen(function* () {
            yield* Effect.tryPromise({
              try: async () => {
                await rename(parentPath, movedParentPath);
                await symlink(movedParentPath, parentPath);
              },
              catch: (cause) =>
                new FilesystemFileOperationError({
                  code: "io_failure",
                  operation: "replace",
                  path: filePath,
                  message: "Failed to prepare the parent pivot fixture.",
                  cause,
                }),
            });
            return yield* filesystem.replaceFileBytes(input);
          }),
      },
      createGitPort(["nested/file.txt"]),
    );
    const loaded = await Effect.runPromise(
      service.readTextFile({ rootPath, relativePath: "nested/file.txt" }),
    );
    if (loaded.kind !== "text") throw new Error("Expected text.");

    const failure = await writeFailure(
      service.writeTextFile({
        rootPath,
        relativePath: "nested/file.txt",
        contents: "draft",
        revision: loaded.revision,
      }),
    );

    expect(failure.code).toBe("unavailable_file");
    expect(await readFile(path.join(movedParentPath, "file.txt"), "utf8")).toBe("same contents");
  });

  test("rejects oversized or binary draft contents without changing the file", async () => {
    const rootPath = await createRoot();
    const filePath = path.join(rootPath, "file.txt");
    await writeFile(filePath, "before");
    const service = createWorkspaceTextFileService(
      createFilesystemAdapter(),
      createGitPort(["file.txt"]),
    );
    const loaded = await Effect.runPromise(
      service.readTextFile({ rootPath, relativePath: "file.txt" }),
    );
    if (loaded.kind !== "text") throw new Error("Expected text.");

    const oversized = await writeFailure(
      service.writeTextFile({
        rootPath,
        relativePath: "file.txt",
        contents: "a".repeat(MAX_WORKSPACE_TEXT_FILE_BYTES + 1),
        revision: loaded.revision,
      }),
    );
    const binary = await writeFailure(
      service.writeTextFile({
        rootPath,
        relativePath: "file.txt",
        contents: "a\0b",
        revision: loaded.revision,
      }),
    );
    const lateBinary = await writeFailure(
      service.writeTextFile({
        rootPath,
        relativePath: "file.txt",
        contents: `${"a".repeat(8192)}\0b`,
        revision: loaded.revision,
      }),
    );

    expect(oversized.code).toBe("unsupported_file");
    expect(binary.code).toBe("unsupported_file");
    expect(lateBinary.code).toBe("unsupported_file");
    expect(await readFile(filePath, "utf8")).toBe("before");
  });

  test("rejects draft contents that cannot round trip through UTF-8", async () => {
    const rootPath = await createRoot();
    const filePath = path.join(rootPath, "file.txt");
    await writeFile(filePath, "before");
    const service = createWorkspaceTextFileService(
      createFilesystemAdapter(),
      createGitPort(["file.txt"]),
    );
    const loaded = await Effect.runPromise(
      service.readTextFile({ rootPath, relativePath: "file.txt" }),
    );
    if (loaded.kind !== "text") throw new Error("Expected text.");

    const failure = await writeFailure(
      service.writeTextFile({
        rootPath,
        relativePath: "file.txt",
        contents: "\ud800",
        revision: loaded.revision,
      }),
    );

    expect(failure.code).toBe("unsupported_file");
    expect(await readFile(filePath, "utf8")).toBe("before");
  });

  test("reports a stale revision before classifying changed current contents", async () => {
    const rootPath = await createRoot();
    const filePath = path.join(rootPath, "file.txt");
    await writeFile(filePath, "before");
    const service = createWorkspaceTextFileService(
      createFilesystemAdapter(),
      createGitPort(["file.txt"]),
    );
    const loaded = await Effect.runPromise(
      service.readTextFile({ rootPath, relativePath: "file.txt" }),
    );
    if (loaded.kind !== "text") throw new Error("Expected text.");
    await writeFile(filePath, new Uint8Array([0x61, 0, 0x62]));

    const failure = await writeFailure(
      service.writeTextFile({
        rootPath,
        relativePath: "file.txt",
        contents: "draft",
        revision: loaded.revision,
      }),
    );

    expect(failure.code).toBe("stale_revision");
  });

  test("rejects unlisted, missing, and escaping files without creating a target", async () => {
    const rootPath = await createRoot();
    const outsideRoot = await createRoot();
    const outsidePath = path.join(outsideRoot, "outside.txt");
    await writeFile(outsidePath, "outside");
    await symlink(outsidePath, path.join(rootPath, "link.txt"));
    const unlistedService = createWorkspaceTextFileService(
      createFilesystemAdapter(),
      createGitPort([]),
    );
    const linkedService = createWorkspaceTextFileService(
      createFilesystemAdapter(),
      createGitPort(["link.txt"]),
    );

    const unlisted = await writeFailure(
      unlistedService.writeTextFile({
        rootPath,
        relativePath: "missing.txt",
        contents: "draft",
        revision: "revision",
      }),
    );
    const escapingError = await writeError(
      linkedService.writeTextFile({
        rootPath,
        relativePath: "link.txt",
        contents: "draft",
        revision: "revision",
      }),
    );
    const escaping = escapingError.failure;

    expect(unlisted.code).toBe("unavailable_file");
    expect(escaping.code).toBe("path_escape");
    expect(escapingError.cause).toBeInstanceOf(WorkspaceFileAccessError);
    expect(escapingError.cause).toMatchObject({ code: "path_escape" });
    expect(await readFile(outsidePath, "utf8")).toBe("outside");
  });

  test("validates raw write input at the service boundary", async () => {
    const service = createWorkspaceTextFileService(createFilesystemAdapter(), createGitPort([]));

    const failure = await writeFailure(
      service.writeTextFile({
        rootPath: "/repo",
        relativePath: "file.txt",
        contents: "saved",
      }),
    );

    expect(failure.code).toBe("invalid_input");
  });

  test("rejects traversal, absolute paths, and directory targets", async () => {
    const rootPath = await createRoot();
    await mkdir(path.join(rootPath, "directory"));
    const service = createWorkspaceTextFileService(
      createFilesystemAdapter(),
      createGitPort(["directory"]),
    );

    const traversal = await writeFailure(
      service.writeTextFile({
        rootPath,
        relativePath: "../outside.txt",
        contents: "draft",
        revision: "revision",
      }),
    );
    const absolute = await writeFailure(
      service.writeTextFile({
        rootPath,
        relativePath: path.join(rootPath, "absolute.txt"),
        contents: "draft",
        revision: "revision",
      }),
    );
    const directory = await writeFailure(
      service.writeTextFile({
        rootPath,
        relativePath: "directory",
        contents: "draft",
        revision: "revision",
      }),
    );

    expect(traversal.code).toBe("unavailable_file");
    expect(absolute.code).toBe("invalid_input");
    expect(directory.code).toBe("unavailable_file");
  });

  test("rejects binary, invalid UTF-8, and oversized current files", async () => {
    const rootPath = await createRoot();
    const filePath = path.join(rootPath, "file.txt");
    const filesystem = createFilesystemAdapter();
    const service = createWorkspaceTextFileService(filesystem, createGitPort(["file.txt"]));
    const cases = [
      new Uint8Array([0x61, 0, 0x62]),
      new Uint8Array([0xc3, 0x28]),
      new Uint8Array(MAX_WORKSPACE_TEXT_FILE_BYTES + 1).fill(0x61),
    ];

    for (const bytes of cases) {
      await writeFile(filePath, bytes);
      const current = await Effect.runPromise(
        filesystem.readFileSnapshot(filePath, MAX_WORKSPACE_TEXT_FILE_BYTES + 1),
      );
      const failure = await writeFailure(
        service.writeTextFile({
          rootPath,
          relativePath: "file.txt",
          contents: "draft",
          revision: current.revision,
        }),
      );
      expect(failure.code).toBe("unsupported_file");
      expect(new Uint8Array(await readFile(filePath))).toEqual(bytes);
    }
  });

  test("does not recreate a file that is deleted or moved after loading", async () => {
    const rootPath = await createRoot();
    const filePath = path.join(rootPath, "file.txt");
    const movedPath = path.join(rootPath, "moved.txt");
    await writeFile(filePath, "before");
    const service = createWorkspaceTextFileService(
      createFilesystemAdapter(),
      createGitPort(["file.txt"]),
    );
    const loaded = await Effect.runPromise(
      service.readTextFile({ rootPath, relativePath: "file.txt" }),
    );
    if (loaded.kind !== "text") throw new Error("Expected text.");
    await rename(filePath, movedPath);

    const failure = await writeFailure(
      service.writeTextFile({
        rootPath,
        relativePath: "file.txt",
        contents: "draft",
        revision: loaded.revision,
      }),
    );

    expect(failure.code).toBe("unavailable_file");
    expect(await readFile(movedPath, "utf8")).toBe("before");
  });

  test("maps write permission failures without changing the draft baseline", async () => {
    const rootPath = await createRoot();
    const filePath = path.join(rootPath, "file.txt");
    await writeFile(filePath, "before");
    const filesystem = createFilesystemAdapter();
    const service = createWorkspaceTextFileService(
      {
        ...filesystem,
        replaceFileBytes: ({ path: targetPath }) =>
          Effect.fail(
            new FilesystemFileOperationError({
              code: "permission_denied",
              operation: "replace",
              path: targetPath,
              message: "Permission denied.",
            }),
          ),
      },
      createGitPort(["file.txt"]),
    );
    const loaded = await Effect.runPromise(
      service.readTextFile({ rootPath, relativePath: "file.txt" }),
    );
    if (loaded.kind !== "text") throw new Error("Expected text.");

    const failure = await writeFailure(
      service.writeTextFile({
        rootPath,
        relativePath: "file.txt",
        contents: "draft",
        revision: loaded.revision,
      }),
    );

    expect(failure.code).toBe("permission_denied");
    expect(await readFile(filePath, "utf8")).toBe("before");
  });

  test("maps write I/O failures without reporting success", async () => {
    const rootPath = await createRoot();
    const filePath = path.join(rootPath, "file.txt");
    await writeFile(filePath, "before");
    const filesystem = createFilesystemAdapter();
    const service = createWorkspaceTextFileService(
      {
        ...filesystem,
        replaceFileBytes: ({ path: targetPath }) =>
          Effect.fail(
            new FilesystemFileOperationError({
              code: "io_failure",
              operation: "replace",
              path: targetPath,
              message: "Disk write failed.",
            }),
          ),
      },
      createGitPort(["file.txt"]),
    );
    const loaded = await Effect.runPromise(
      service.readTextFile({ rootPath, relativePath: "file.txt" }),
    );
    if (loaded.kind !== "text") throw new Error("Expected text.");

    const failure = await writeFailure(
      service.writeTextFile({
        rootPath,
        relativePath: "file.txt",
        contents: "draft",
        revision: loaded.revision,
      }),
    );

    expect(failure.code).toBe("io_failure");
    expect(await readFile(filePath, "utf8")).toBe("before");
  });
});
