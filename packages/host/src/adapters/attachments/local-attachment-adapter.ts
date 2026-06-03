import { mkdir, readdir, realpath, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { toHostOperationError, toHostPathStatError } from "../../effect/host-errors";
import type { LocalAttachmentEntry, LocalAttachmentPort } from "../../ports/local-attachment-port";

const localAttachmentStageDirName = "openducktor-local-attachments";

export const createLocalAttachmentAdapter = (): LocalAttachmentPort => ({
  stageDirectory() {
    return path.join(os.tmpdir(), localAttachmentStageDirName);
  },
  joinPath(...segments) {
    return path.join(...segments);
  },
  relativePath(from, to) {
    return path.relative(from, to);
  },
  isAbsolutePath(inputPath) {
    return path.isAbsolute(inputPath);
  },
  canonicalizePath(inputPath) {
    return Effect.tryPromise({
      try: () => realpath(inputPath),
      catch: (cause) =>
        toHostOperationError(cause, "localAttachment.canonicalizePath", {
          path: inputPath,
        }),
    });
  },
  ensureDirectory(inputPath) {
    return Effect.tryPromise({
      try: () => mkdir(inputPath, { recursive: true }),
      catch: (cause) =>
        toHostOperationError(cause, "localAttachment.ensureDirectory", { path: inputPath }),
    }).pipe(Effect.asVoid);
  },
  writeFile(inputPath, bytes) {
    return Effect.tryPromise({
      try: () => writeFile(inputPath, bytes),
      catch: (cause) =>
        toHostOperationError(cause, "localAttachment.writeFile", {
          path: inputPath,
        }),
    });
  },
  readDirectory(inputPath) {
    return Effect.gen(function* () {
      const entries = yield* Effect.tryPromise({
        try: () => readdir(inputPath, { withFileTypes: true }),
        catch: (cause) =>
          toHostOperationError(cause, "localAttachment.readDirectory", { path: inputPath }),
      });
      return entries.map(
        (entry): LocalAttachmentEntry => ({
          path: path.join(inputPath, entry.name),
          fileName: entry.name,
        }),
      );
    });
  },
  modifiedTimeMs(inputPath) {
    return Effect.gen(function* () {
      const metadata = yield* Effect.tryPromise({
        try: () => stat(inputPath),
        catch: (cause) => toHostOperationError(cause, "localAttachment.modifiedTimeMs"),
      });
      return metadata.mtimeMs;
    });
  },
  exists(inputPath) {
    return Effect.tryPromise({
      try: () => stat(inputPath),
      catch: (cause) => toHostPathStatError(cause, "localAttachment.exists", inputPath),
    }).pipe(
      Effect.as(true),
      Effect.catchTag("HostPathNotFoundError", () => Effect.succeed(false)),
    );
  },
});
