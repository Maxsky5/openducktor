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
const createFakeLocalAttachmentPort = () => {
  const files = new Map<string, FakeFile>();
  const directories = new Set<string>(["/tmp/openducktor-local-attachments"]);
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
          if (!directories.has(path)) {
            const error = new Error(`missing directory: ${path}`) as Error & {
              code: string;
            };
            error.code = "ENOENT";
            throw error;
          }
          return [...files.keys()]
            .filter((filePath) => filePath.startsWith(`${path}/`))
            .map(
              (filePath): LocalAttachmentEntry => ({
                path: filePath,
                fileName: filePath.slice(path.length + 1),
              }),
            );
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
      return Effect.succeed(directories.has(path) || files.has(path));
    },
  };
  return {
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
    const { port } = createFakeLocalAttachmentPort();
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
    expect(older.path).not.toBe(newer.path);
  });
  test("resolves absolute staged paths and rejects outside absolute paths", async () => {
    const { port } = createFakeLocalAttachmentPort();
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
