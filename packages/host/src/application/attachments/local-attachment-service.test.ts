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
  readDirectoryDelay?: () => Promise<void>;
};
const createFakeLocalAttachmentPort = (options: FakeLocalAttachmentPortOptions = {}) => {
  const files = new Map<string, FakeFile>();
  const directories = new Set<string>(["/tmp/openducktor-local-attachments"]);
  const calls = {
    exists: 0,
    modifiedTimeMs: 0,
    readDirectory: 0,
  };
  let nextModifiedTimeMs = 1;
  const port: LocalAttachmentPort = {
    stageDirectory() {
      return "/tmp/openducktor-local-attachments";
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
          directories.add(path);
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
          files.set(path, { bytes, modifiedTimeMs: nextModifiedTimeMs });
          nextModifiedTimeMs += 1;
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
          return files.get(path)?.modifiedTimeMs ?? 0;
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
      return Effect.succeed(directories.has(path) || files.has(path));
    },
  };
  return {
    calls,
    files,
    port: port as LocalAttachmentPort,
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
    expect(calls.modifiedTimeMs).toBe(2);
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
    await Promise.resolve();
    await Promise.resolve();
    expect(calls.readDirectory).toBe(1);
    releaseReadDirectory();
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
    const staged = await Effect.runPromise(
      service.stage({ name: "brief.pdf", base64Data: "YnJpZWY=" }),
    );
    releaseReadDirectory();
    await expect(resolving).resolves.toEqual({ path: staged.path });
    expect(calls.readDirectory).toBe(1);
  });
  test("updates the loaded attachment index after staging a newer duplicate", async () => {
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
    expect(calls.readDirectory).toBe(1);
    expect(calls.modifiedTimeMs).toBe(2);
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
    await expect(Effect.runPromise(service.resolve({ path: "../brief.pdf" }))).rejects.toThrow(
      "Attachment path must be a staged attachment filename token.",
    );
  });
});
