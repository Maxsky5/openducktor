import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { LocalAttachmentEntry, LocalAttachmentPort } from "../../ports/local-attachment-port";
import { createLocalAttachmentService as createEffectLocalAttachmentService } from "./local-attachment-service";

const createLocalAttachmentService = (
  ...args: Parameters<typeof createEffectLocalAttachmentService>
) => createEffectLocalAttachmentService(...args);
type FakeFile = {
  bytes: Uint8Array;
  modifiedTimeMs: number;
};
type FakeLocalAttachmentPortOptions = {
  includeStageDirectory?: boolean;
  readDirectoryDelay?: () => Promise<void>;
};
const createFakeLocalAttachmentPort = (options: FakeLocalAttachmentPortOptions = {}) => {
  const attachmentDirectory = "/tmp/openducktor-local-attachments";
  const files = new Map<string, FakeFile>();
  const directories = new Map<string, number>(
    options.includeStageDirectory === false ? [] : [[attachmentDirectory, 1]],
  );
  const failModifiedTimePaths = new Set<string>();
  const calls = {
    exists: 0,
    existsPaths: [] as string[],
    modifiedTimeMs: 0,
    readDirectory: 0,
  };
  let nextModifiedTimeMs = 2;
  const nextModifiedTime = (): number => {
    const modifiedTimeMs = nextModifiedTimeMs;
    nextModifiedTimeMs += 1;
    return modifiedTimeMs;
  };
  const parentDirectory = (filePath: string): string => {
    const lastSeparatorIndex = filePath.lastIndexOf("/");
    return lastSeparatorIndex > 0 ? filePath.slice(0, lastSeparatorIndex) : "/";
  };
  const writeFileFixture = (path: string, bytes: Uint8Array): void => {
    files.set(path, { bytes, modifiedTimeMs: nextModifiedTime() });
    const directory = parentDirectory(path);
    if (directories.has(directory)) {
      directories.set(directory, nextModifiedTime());
    }
  };
  const port: LocalAttachmentPort = {
    stageDirectory() {
      return attachmentDirectory;
    },
    joinPath(...segments) {
      return segments.join("/").replaceAll(/\/+/g, "/");
    },
    relativePath(from, to) {
      if (to === from) {
        return "";
      }
      if (to.startsWith(`${from}/`)) {
        return to.slice(from.length + 1);
      }
      return "../outside";
    },
    isAbsolutePath(path) {
      return path.startsWith("/");
    },
    canonicalizePath(path) {
      return Effect.tryPromise({
        try: async () => {
          if (!directories.has(path) && !files.has(path)) {
            throw new Error(`missing path fixture: ${path}`);
          }
          return path;
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    ensureDirectory(path) {
      return Effect.tryPromise({
        try: async () => {
          if (!directories.has(path)) {
            directories.set(path, nextModifiedTime());
          }
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    writeFile(path, bytes) {
      return Effect.tryPromise({
        try: async () => {
          writeFileFixture(path, bytes);
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    readDirectory(path) {
      return Effect.tryPromise({
        try: async () => {
          calls.readDirectory += 1;
          if (!directories.has(path)) {
            const error = new Error(`missing directory: ${path}`) as Error & {
              code: string;
            };
            error.code = "ENOENT";
            throw error;
          }
          const entries = [...files.keys()]
            .filter((filePath) => filePath.startsWith(`${path}/`))
            .map(
              (filePath): LocalAttachmentEntry => ({
                path: filePath,
                fileName: filePath.slice(path.length + 1),
              }),
            );
          await options.readDirectoryDelay?.();
          return entries;
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    modifiedTimeMs(path) {
      return Effect.tryPromise({
        try: async () => {
          calls.modifiedTimeMs += 1;
          if (failModifiedTimePaths.has(path)) {
            throw new Error(`stat failed for fixture path: ${path}`);
          }
          const fileModifiedTimeMs = files.get(path)?.modifiedTimeMs;
          if (fileModifiedTimeMs !== undefined) {
            return fileModifiedTimeMs;
          }
          const directoryModifiedTimeMs = directories.get(path);
          if (directoryModifiedTimeMs !== undefined) {
            return directoryModifiedTimeMs;
          }
          const error = new Error(`missing path fixture: ${path}`) as Error & {
            code: string;
          };
          error.code = "ENOENT";
          throw error;
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    exists(path) {
      calls.exists += 1;
      calls.existsPaths.push(path);
      return Effect.succeed(directories.has(path) || files.has(path));
    },
  };
  return {
    calls,
    failModifiedTimePaths,
    files,
    port: port as LocalAttachmentPort,
    writeExternalFile(fileName: string, contents: string) {
      const filePath = `${attachmentDirectory}/${fileName}`;
      writeFileFixture(filePath, new TextEncoder().encode(contents));
      return filePath;
    },
  };
};
describe("createLocalAttachmentService", () => {
  test("stages decoded attachment bytes under the staging directory", async () => {
    const { files, port } = createFakeLocalAttachmentPort();
    const service = createLocalAttachmentService(port);
    const staged = await Effect.runPromise(
      service.stage({
        name: " ../../Preview:%?.png ",
        base64Data: "cHJldmlldy1ieXRlcw==",
      }),
    );
    expect(staged.path).toMatch(
      /^\/tmp\/openducktor-local-attachments\/[0-9a-f-]{36}-_.._Preview___.png$/,
    );
    expect(Buffer.from(files.get(staged.path)?.bytes ?? []).toString("utf8")).toBe("preview-bytes");
  });
  test("resolves relative filename tokens to the newest staged attachment", async () => {
    const { calls, port } = createFakeLocalAttachmentPort();
    const service = createLocalAttachmentService(port);
    const older = await Effect.runPromise(
      service.stage({ name: "brief.pdf", base64Data: "b2xkZXI=" }),
    );
    const newer = await Effect.runPromise(
      service.stage({ name: "brief.pdf", base64Data: "bmV3ZXI=" }),
    );
    await expect(Effect.runPromise(service.resolve({ path: "brief.pdf" }))).resolves.toEqual({
      path: newer.path,
    });
    await expect(Effect.runPromise(service.resolve({ path: "brief.pdf" }))).resolves.toEqual({
      path: newer.path,
    });
    expect(older.path).not.toBe(newer.path);
    expect(calls.readDirectory).toBe(1);
    expect(calls.modifiedTimeMs).toBe(4);
  });
  test("refreshes a loaded index when another writer stages a newer matching attachment", async () => {
    const { calls, port, writeExternalFile } = createFakeLocalAttachmentPort();
    const service = createLocalAttachmentService(port);
    const older = await Effect.runPromise(
      service.stage({ name: "brief.pdf", base64Data: "b2xkZXI=" }),
    );
    await expect(Effect.runPromise(service.resolve({ path: "brief.pdf" }))).resolves.toEqual({
      path: older.path,
    });
    const externalPath = writeExternalFile(
      "00000000-0000-0000-0000-000000000999-brief.pdf",
      "newer",
    );
    await expect(Effect.runPromise(service.resolve({ path: "brief.pdf" }))).resolves.toEqual({
      path: externalPath,
    });
    expect(calls.readDirectory).toBe(2);
  });
  test("shares one stale index reload across concurrent relative resolves", async () => {
    let delayReadDirectory = false;
    let markReadDirectoryStarted: () => void = () => {};
    let releaseReadDirectory: () => void = () => {};
    const readDirectoryStarted = new Promise<void>((resolve) => {
      markReadDirectoryStarted = resolve;
    });
    const readDirectoryReleased = new Promise<void>((resolve) => {
      releaseReadDirectory = resolve;
    });
    const { calls, port, writeExternalFile } = createFakeLocalAttachmentPort({
      readDirectoryDelay: async () => {
        if (!delayReadDirectory) {
          return;
        }
        markReadDirectoryStarted();
        await readDirectoryReleased;
      },
    });
    const service = createLocalAttachmentService(port);
    const older = await Effect.runPromise(
      service.stage({ name: "brief.pdf", base64Data: "b2xkZXI=" }),
    );
    await expect(Effect.runPromise(service.resolve({ path: "brief.pdf" }))).resolves.toEqual({
      path: older.path,
    });
    delayReadDirectory = true;
    const externalPath = writeExternalFile(
      "00000000-0000-0000-0000-000000000999-brief.pdf",
      "newer",
    );
    const resolving = Effect.runPromise(
      Effect.all([service.resolve({ path: "brief.pdf" }), service.resolve({ path: "brief.pdf" })], {
        concurrency: "unbounded",
      }),
    );
    await readDirectoryStarted;
    try {
      await Promise.resolve();
      await Promise.resolve();
      expect(calls.readDirectory).toBe(2);
    } finally {
      releaseReadDirectory();
    }
    await expect(resolving).resolves.toEqual([{ path: externalPath }, { path: externalPath }]);
    expect(calls.readDirectory).toBe(2);
  });
  test("skips unrelated entries that vanish while loading the staged index", async () => {
    let stalePath = "";
    const { calls, files, port, writeExternalFile } = createFakeLocalAttachmentPort({
      readDirectoryDelay: async () => {
        if (stalePath.length > 0) {
          files.delete(stalePath);
        }
      },
    });
    const service = createLocalAttachmentService(port);
    const staged = await Effect.runPromise(
      service.stage({ name: "brief.pdf", base64Data: "YnJpZWY=" }),
    );
    stalePath = writeExternalFile("00000000-0000-0000-0000-000000000111-unrelated.txt", "stale");
    await expect(Effect.runPromise(service.resolve({ path: "brief.pdf" }))).resolves.toEqual({
      path: staged.path,
    });
    expect(calls.readDirectory).toBe(1);
  });
  test("shares one cold index load across concurrent relative resolves", async () => {
    let markReadDirectoryStarted: () => void = () => {};
    let releaseReadDirectory: () => void = () => {};
    const readDirectoryStarted = new Promise<void>((resolve) => {
      markReadDirectoryStarted = resolve;
    });
    const readDirectoryReleased = new Promise<void>((resolve) => {
      releaseReadDirectory = resolve;
    });
    const { calls, port } = createFakeLocalAttachmentPort({
      readDirectoryDelay: async () => {
        markReadDirectoryStarted();
        await readDirectoryReleased;
      },
    });
    const service = createLocalAttachmentService(port);
    const staged = await Effect.runPromise(
      service.stage({ name: "brief.pdf", base64Data: "YnJpZWY=" }),
    );
    const resolving = Effect.runPromise(
      Effect.all([service.resolve({ path: "brief.pdf" }), service.resolve({ path: "brief.pdf" })], {
        concurrency: "unbounded",
      }),
    );
    await readDirectoryStarted;
    try {
      await Promise.resolve();
      await Promise.resolve();
      expect(calls.readDirectory).toBe(1);
    } finally {
      releaseReadDirectory();
    }
    await expect(resolving).resolves.toEqual([{ path: staged.path }, { path: staged.path }]);
    expect(calls.readDirectory).toBe(1);
  });
  test("merges attachments staged while a cold index load is in flight", async () => {
    let markReadDirectoryStarted: () => void = () => {};
    let releaseReadDirectory: () => void = () => {};
    const readDirectoryStarted = new Promise<void>((resolve) => {
      markReadDirectoryStarted = resolve;
    });
    const readDirectoryReleased = new Promise<void>((resolve) => {
      releaseReadDirectory = resolve;
    });
    const { calls, port } = createFakeLocalAttachmentPort({
      readDirectoryDelay: async () => {
        markReadDirectoryStarted();
        await readDirectoryReleased;
      },
    });
    const service = createLocalAttachmentService(port);
    const resolving = Effect.runPromise(service.resolve({ path: "brief.pdf" }));
    await readDirectoryStarted;
    let staged: { path: string } | undefined;
    try {
      staged = await Effect.runPromise(
        service.stage({ name: "brief.pdf", base64Data: "YnJpZWY=" }),
      );
    } finally {
      releaseReadDirectory();
    }
    if (!staged) {
      throw new Error("Expected the staged attachment to be created.");
    }
    await expect(resolving).resolves.toEqual({ path: staged.path });
    expect(calls.readDirectory).toBe(1);
  });
  test("resolves a newer duplicate after staging changes the directory timestamp", async () => {
    const { calls, port } = createFakeLocalAttachmentPort();
    const service = createLocalAttachmentService(port);
    const older = await Effect.runPromise(
      service.stage({ name: "brief.pdf", base64Data: "b2xkZXI=" }),
    );
    await expect(Effect.runPromise(service.resolve({ path: "brief.pdf" }))).resolves.toEqual({
      path: older.path,
    });
    const newer = await Effect.runPromise(
      service.stage({ name: "brief.pdf", base64Data: "bmV3ZXI=" }),
    );
    await expect(Effect.runPromise(service.resolve({ path: "brief.pdf" }))).resolves.toEqual({
      path: newer.path,
    });
    expect(calls.readDirectory).toBe(2);
    expect(calls.modifiedTimeMs).toBe(6);
  });
  test("staging succeeds when file stat would fail after a loaded index exists", async () => {
    const firstAttachmentId = "00000000-0000-0000-0000-000000000001";
    const secondAttachmentId = "00000000-0000-0000-0000-000000000002";
    const attachmentIds = [firstAttachmentId, secondAttachmentId];
    const { calls, failModifiedTimePaths, files, port } = createFakeLocalAttachmentPort();
    const service = createLocalAttachmentService(
      port,
      () => attachmentIds.shift() ?? secondAttachmentId,
    );
    const older = await Effect.runPromise(
      service.stage({ name: "brief.pdf", base64Data: "b2xkZXI=" }),
    );
    await expect(Effect.runPromise(service.resolve({ path: "brief.pdf" }))).resolves.toEqual({
      path: older.path,
    });
    const expectedPath = `/tmp/openducktor-local-attachments/${secondAttachmentId}-brief.pdf`;
    failModifiedTimePaths.add(expectedPath);
    const modifiedTimeCallsBeforeStage = calls.modifiedTimeMs;
    await expect(
      Effect.runPromise(service.stage({ name: "brief.pdf", base64Data: "bmV3ZXI=" })),
    ).resolves.toEqual({ path: expectedPath });
    expect(files.has(expectedPath)).toBe(true);
    expect(calls.modifiedTimeMs).toBe(modifiedTimeCallsBeforeStage);
  });
  test("resolves absolute staged paths and rejects outside absolute paths", async () => {
    const { calls, port } = createFakeLocalAttachmentPort();
    const service = createLocalAttachmentService(port);
    const staged = await Effect.runPromise(
      service.stage({ name: "brief.pdf", base64Data: "YnJpZWY=" }),
    );
    await expect(Effect.runPromise(service.resolve({ path: staged.path }))).resolves.toEqual({
      path: staged.path,
    });
    await expect(
      Effect.runPromise(service.resolve({ path: "/tmp/not-staged.pdf" })),
    ).rejects.toThrow("Failed to resolve staged attachment path:");
    expect(calls.readDirectory).toBe(0);
    expect(calls.modifiedTimeMs).toBe(0);
  });
  test("prunes stale indexed attachment entries before resolving relative tokens", async () => {
    const { calls, files, port } = createFakeLocalAttachmentPort();
    const service = createLocalAttachmentService(port);
    const older = await Effect.runPromise(
      service.stage({ name: "brief.pdf", base64Data: "b2xkZXI=" }),
    );
    const newer = await Effect.runPromise(
      service.stage({ name: "brief.pdf", base64Data: "bmV3ZXI=" }),
    );
    await expect(Effect.runPromise(service.resolve({ path: "brief.pdf" }))).resolves.toEqual({
      path: newer.path,
    });
    files.delete(newer.path);
    await expect(Effect.runPromise(service.resolve({ path: "brief.pdf" }))).resolves.toEqual({
      path: older.path,
    });
    files.delete(older.path);
    await expect(Effect.runPromise(service.resolve({ path: "brief.pdf" }))).rejects.toThrow(
      "No staged local attachment matches 'brief.pdf'.",
    );
    expect(calls.readDirectory).toBe(1);
    expect(calls.existsPaths).toEqual([newer.path, newer.path, older.path, older.path]);
  });
  test("returns a validation error when resolving a relative token without a staging directory", async () => {
    const { calls, port } = createFakeLocalAttachmentPort({ includeStageDirectory: false });
    const service = createLocalAttachmentService(port);
    await expect(Effect.runPromise(service.resolve({ path: "brief.pdf" }))).rejects.toThrow(
      "No staged local attachment matches 'brief.pdf'.",
    );
    expect(calls.readDirectory).toBe(1);
  });
  test("rejects blank names, blank payloads, and unsafe lookup tokens", async () => {
    const { port } = createFakeLocalAttachmentPort();
    const service = createLocalAttachmentService(port);
    await expect(
      Effect.runPromise(service.stage({ name: " ", base64Data: "YnJpZWY=" })),
    ).rejects.toThrow("Attachment name is required.");
    await expect(
      Effect.runPromise(service.stage({ name: "brief.pdf", base64Data: " " })),
    ).rejects.toThrow("Attachment payload is required.");
    await expect(Effect.runPromise(service.resolve({ path: " " }))).rejects.toThrow(
      "Attachment path is required.",
    );
    await expect(Effect.runPromise(service.resolve({ path: "../brief.pdf" }))).rejects.toThrow(
      "Attachment path must be a staged attachment filename token.",
    );
    await expect(Effect.runPromise(service.resolve({ path: "folder\\brief.pdf" }))).rejects.toThrow(
      "Attachment path must be a staged attachment filename token.",
    );
    await expect(Effect.runPromise(service.resolve({ path: "." }))).rejects.toThrow(
      "Attachment path must be a staged attachment filename token.",
    );
    await expect(Effect.runPromise(service.resolve({ path: ".." }))).rejects.toThrow(
      "Attachment path must be a staged attachment filename token.",
    );
  });
});
