import {
  type WorkspaceTextFileReadResult,
  type WorkspaceTextFileWriteFailure,
  type WorkspaceTextFileWriteFailureCode,
  type WorkspaceTextFileWriteInput,
  type WorkspaceTextFileWriteResult,
  workspaceTextFileReadResultSchema,
  workspaceTextFileWriteInputSchema,
  workspaceTextFileWriteResultSchema,
} from "@openducktor/contracts";
import { Data, Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type {
  FilesystemFileOperationError,
  FilesystemFileSnapshot,
  FilesystemPort,
} from "../../ports/filesystem-port";
import type { GitPort } from "../../ports/git-port";
import {
  canonicalizeContainedWorkspaceFile,
  canonicalizeWorkspaceRoot,
  loadWorkspaceFilePaths,
  type WorkspaceFileAccessError,
  workspaceFileValidationError,
} from "./workspace-file-access";
import { requireRelativePath } from "./workspace-files-paths";

export const MAX_WORKSPACE_TEXT_FILE_BYTES = 1024 * 1024;
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const TEXT_ENCODER = new TextEncoder();

export class WorkspaceTextFileWriteError extends Data.TaggedError("WorkspaceTextFileWriteError")<{
  readonly message: string;
  readonly failure: WorkspaceTextFileWriteFailure;
  readonly cause?: unknown;
}> {}

export type WorkspaceTextFileService = {
  readTextFile(input: {
    rootPath: string;
    relativePath: string;
  }): Effect.Effect<WorkspaceTextFileReadResult, HostValidationError>;
  writeTextFile(
    input: unknown,
  ): Effect.Effect<WorkspaceTextFileWriteResult, WorkspaceTextFileWriteError>;
};

const isBinaryBytes = (bytes: Uint8Array, maxBytes = 8192): boolean => {
  const sampleLength = Math.min(bytes.byteLength, maxBytes);
  for (let index = 0; index < sampleLength; index += 1) {
    if (bytes[index] === 0) {
      return true;
    }
  }
  return false;
};

const readSnapshotAsText = (
  snapshot: FilesystemFileSnapshot,
  input: { rootPath: string; relativePath: string },
): Effect.Effect<string, HostValidationError> => {
  if (!snapshot.isFile) {
    return Effect.fail(
      new HostValidationError({
        field: "relativePath",
        message: `Selected path is not a file: ${input.relativePath}`,
        details: input,
      }),
    );
  }
  if (isBinaryBytes(snapshot.bytes)) {
    return Effect.fail(
      new HostValidationError({
        field: "relativePath",
        message: "Binary files cannot be edited as text.",
        details: input,
      }),
    );
  }
  return Effect.try({
    try: () => TEXT_DECODER.decode(snapshot.bytes),
    catch: (cause) =>
      workspaceFileValidationError(
        cause,
        `File '${input.relativePath}' is not valid UTF-8 text.`,
        input,
      ),
  });
};

const writeFailure = (
  code: WorkspaceTextFileWriteFailureCode,
  message: string,
  input: Pick<WorkspaceTextFileWriteInput, "rootPath" | "relativePath">,
  cause?: unknown,
): WorkspaceTextFileWriteError =>
  new WorkspaceTextFileWriteError({
    message,
    failure: {
      code,
      message,
      rootPath: input.rootPath,
      relativePath: input.relativePath,
    },
    cause,
  });

const invalidWriteInput = (input: unknown, cause: unknown): WorkspaceTextFileWriteError => {
  const record = typeof input === "object" && input !== null ? input : {};
  const rootPath =
    "rootPath" in record && typeof record.rootPath === "string" ? record.rootPath : ".";
  const relativePath =
    "relativePath" in record && typeof record.relativePath === "string"
      ? record.relativePath
      : "unknown";
  return writeFailure(
    "invalid_input",
    "The workspace text file write input is invalid.",
    { rootPath: rootPath || ".", relativePath: relativePath || "unknown" },
    cause,
  );
};

const mapValidationFailure = (
  cause: HostValidationError,
  input: WorkspaceTextFileWriteInput,
): WorkspaceTextFileWriteError => writeFailure("invalid_input", cause.message, input, cause);

const mapAccessFailure = (
  cause: WorkspaceFileAccessError,
  input: WorkspaceTextFileWriteInput,
): WorkspaceTextFileWriteError => writeFailure(cause.code, cause.message, input, cause);

const mapReadAccessFailure = (cause: WorkspaceFileAccessError): HostValidationError =>
  new HostValidationError({
    message: cause.message,
    field: cause.field,
    details: cause.details,
    cause,
  });

const mapFileOperationFailure = (
  cause: FilesystemFileOperationError,
  input: WorkspaceTextFileWriteInput,
): WorkspaceTextFileWriteError => {
  const codeByOperation = {
    io_failure: "io_failure",
    permission_denied: "permission_denied",
    stale_revision: "stale_revision",
    too_large: "unsupported_file",
    unavailable_file: "unavailable_file",
  } as const satisfies Record<
    FilesystemFileOperationError["code"],
    WorkspaceTextFileWriteFailureCode
  >;
  return writeFailure(codeByOperation[cause.code], cause.message, input, cause);
};

const unsupportedWrite = (
  message: string,
  input: WorkspaceTextFileWriteInput,
): WorkspaceTextFileWriteError => writeFailure("unsupported_file", message, input);

export const createWorkspaceTextFileService = (
  filesystem: FilesystemPort,
  gitPort: GitPort,
): WorkspaceTextFileService => ({
  readTextFile(input) {
    return Effect.gen(function* () {
      const canonicalRoot = yield* canonicalizeWorkspaceRoot(filesystem, input.rootPath);
      const relativePath = yield* requireRelativePath(input.relativePath);
      const listedFilePaths = yield* loadWorkspaceFilePaths(gitPort, canonicalRoot);
      if (!listedFilePaths.includes(relativePath)) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "relativePath",
            message: `File '${relativePath}' is not available in the workspace file tree.`,
            details: { rootPath: canonicalRoot, relativePath },
          }),
        );
      }
      const canonicalPath = yield* canonicalizeContainedWorkspaceFile(
        filesystem,
        canonicalRoot,
        relativePath,
        listedFilePaths,
      ).pipe(Effect.mapError(mapReadAccessFailure));
      const snapshot = yield* filesystem
        .readFileSnapshot(canonicalPath, MAX_WORKSPACE_TEXT_FILE_BYTES + 1)
        .pipe(
          Effect.mapError((cause) =>
            workspaceFileValidationError(cause, `Unable to read file '${relativePath}'.`, {
              rootPath: canonicalRoot,
              relativePath,
            }),
          ),
        );
      if (snapshot.bytes.byteLength > MAX_WORKSPACE_TEXT_FILE_BYTES) {
        return workspaceTextFileReadResultSchema.parse({
          kind: "unsupported",
          rootPath: canonicalRoot,
          relativePath,
          reason: "too_large",
          message: `File is too large to preview (${snapshot.size} bytes).`,
          size: snapshot.size,
          mtimeMs: snapshot.mtimeMs,
        });
      }
      if (isBinaryBytes(snapshot.bytes)) {
        return workspaceTextFileReadResultSchema.parse({
          kind: "unsupported",
          rootPath: canonicalRoot,
          relativePath,
          reason: "binary",
          message: "Binary files cannot be previewed as text.",
          size: snapshot.size,
          mtimeMs: snapshot.mtimeMs,
        });
      }
      const contents = yield* readSnapshotAsText(snapshot, {
        rootPath: canonicalRoot,
        relativePath,
      });
      return workspaceTextFileReadResultSchema.parse({
        kind: "text",
        rootPath: canonicalRoot,
        relativePath,
        contents,
        size: snapshot.size,
        mtimeMs: snapshot.mtimeMs,
        revision: snapshot.revision,
      });
    });
  },
  writeTextFile(rawInput) {
    return Effect.gen(function* () {
      const parsedInput = workspaceTextFileWriteInputSchema.safeParse(rawInput);
      if (!parsedInput.success) {
        return yield* Effect.fail(invalidWriteInput(rawInput, parsedInput.error));
      }
      const input = parsedInput.data;
      if (input.contents.length > MAX_WORKSPACE_TEXT_FILE_BYTES) {
        return yield* Effect.fail(
          unsupportedWrite(
            `File contents exceed the ${MAX_WORKSPACE_TEXT_FILE_BYTES}-byte edit limit.`,
            input,
          ),
        );
      }
      const bytes = TEXT_ENCODER.encode(input.contents);
      if (TEXT_DECODER.decode(bytes) !== input.contents) {
        return yield* Effect.fail(
          unsupportedWrite("File contents must be valid UTF-8 text.", input),
        );
      }
      if (bytes.byteLength > MAX_WORKSPACE_TEXT_FILE_BYTES) {
        return yield* Effect.fail(
          unsupportedWrite(
            `File contents exceed the ${MAX_WORKSPACE_TEXT_FILE_BYTES}-byte edit limit.`,
            input,
          ),
        );
      }
      if (isBinaryBytes(bytes, bytes.byteLength)) {
        return yield* Effect.fail(
          unsupportedWrite("Binary contents cannot be saved as text.", input),
        );
      }

      const canonicalRoot = yield* canonicalizeWorkspaceRoot(filesystem, input.rootPath).pipe(
        Effect.mapError((cause) => mapValidationFailure(cause, input)),
      );
      const relativePath = yield* requireRelativePath(input.relativePath).pipe(
        Effect.mapError((cause) => mapValidationFailure(cause, input)),
      );
      const canonicalInput = { ...input, rootPath: canonicalRoot, relativePath };
      const listedFilePaths = yield* loadWorkspaceFilePaths(gitPort, canonicalRoot).pipe(
        Effect.mapError((cause) => mapValidationFailure(cause, canonicalInput)),
      );
      if (!listedFilePaths.includes(relativePath)) {
        return yield* Effect.fail(
          writeFailure(
            "unavailable_file",
            `File '${relativePath}' is not available in the workspace file tree.`,
            canonicalInput,
          ),
        );
      }
      const canonicalPath = yield* canonicalizeContainedWorkspaceFile(
        filesystem,
        canonicalRoot,
        relativePath,
        listedFilePaths,
      ).pipe(Effect.mapError((cause) => mapAccessFailure(cause, canonicalInput)));
      const current = yield* filesystem
        .readFileSnapshot(canonicalPath, MAX_WORKSPACE_TEXT_FILE_BYTES + 1)
        .pipe(Effect.mapError((cause) => mapFileOperationFailure(cause, canonicalInput)));
      if (current.revision !== input.revision) {
        return yield* Effect.fail(
          writeFailure(
            "stale_revision",
            "The file changed after it was loaded. Reload it before saving.",
            canonicalInput,
          ),
        );
      }
      if (current.bytes.byteLength > MAX_WORKSPACE_TEXT_FILE_BYTES) {
        return yield* Effect.fail(
          unsupportedWrite("The current file is too large to edit.", canonicalInput),
        );
      }
      yield* readSnapshotAsText(current, canonicalInput).pipe(
        Effect.mapError((cause) => unsupportedWrite(cause.message, canonicalInput)),
      );
      const saved = yield* filesystem
        .replaceFileBytes({
          canonicalRootPath: canonicalRoot,
          path: canonicalPath,
          expectedRevision: input.revision,
          bytes,
          maxCurrentBytes: MAX_WORKSPACE_TEXT_FILE_BYTES,
        })
        .pipe(Effect.mapError((cause) => mapFileOperationFailure(cause, canonicalInput)));
      const contents = yield* readSnapshotAsText(saved, canonicalInput).pipe(
        Effect.mapError((cause) =>
          writeFailure("io_failure", cause.message, canonicalInput, cause),
        ),
      );
      return workspaceTextFileWriteResultSchema.parse({
        kind: "text",
        rootPath: canonicalRoot,
        relativePath,
        contents,
        size: saved.size,
        mtimeMs: saved.mtimeMs,
        revision: saved.revision,
      });
    });
  },
});
