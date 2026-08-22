import { Data, Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { FilesystemPort } from "../../ports/filesystem-port";
import type { GitPort } from "../../ports/git-port";
import { isContainedPath } from "./workspace-files-paths";
import type { JsonValue } from "@openducktor/contracts";

export const workspaceFileValidationError = (
  cause: unknown,
  message: string,
  details?: Record<string, JsonValue | undefined>,
): HostValidationError =>
  new HostValidationError({
    message,
    cause,
    ...(details ? { details } : undefined),
  });

export class WorkspaceFileAccessError extends Data.TaggedError("WorkspaceFileAccessError")<{
  readonly code: "path_escape" | "unavailable_file";
  readonly message: string;
  readonly field: "relativePath";
  readonly details: { rootPath: string; relativePath: string };
  readonly cause?: unknown;
}> {}

export const canonicalizeWorkspaceRoot = (filesystem: FilesystemPort, rootPath: string) =>
  Effect.gen(function* () {
    const canonicalRoot = yield* filesystem.canonicalize(rootPath).pipe(
      Effect.mapError((cause) =>
        workspaceFileValidationError(cause, `Unable to resolve workspace root '${rootPath}'.`, {
          rootPath,
        }),
      ),
    );
    const metadata = yield* filesystem
      .stat(canonicalRoot)
      .pipe(
        Effect.mapError((cause) =>
          workspaceFileValidationError(
            cause,
            `Unable to inspect workspace root '${canonicalRoot}'.`,
            { rootPath: canonicalRoot },
          ),
        ),
      );
    if (!metadata.isDirectory) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "rootPath",
          message: `Workspace root is not a directory: ${canonicalRoot}`,
          details: { rootPath: canonicalRoot },
        }),
      );
    }
    return canonicalRoot;
  });

export const loadWorkspaceFilePaths = (gitPort: GitPort, canonicalRoot: string) =>
  Effect.gen(function* () {
    const isGitRepository = yield* gitPort
      .isGitRepository(canonicalRoot)
      .pipe(
        Effect.mapError((cause) =>
          workspaceFileValidationError(
            cause,
            `Unable to inspect Git repository '${canonicalRoot}'.`,
            { rootPath: canonicalRoot },
          ),
        ),
      );
    if (!isGitRepository) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "rootPath",
          message: `File explorer requires a Git repository root: ${canonicalRoot}`,
          details: { rootPath: canonicalRoot },
        }),
      );
    }

    return yield* gitPort.listFiles(canonicalRoot).pipe(
      Effect.mapError((cause) =>
        workspaceFileValidationError(cause, `Unable to list Git files for '${canonicalRoot}'.`, {
          rootPath: canonicalRoot,
        }),
      ),
    );
  });

export const canonicalizeContainedWorkspaceFile = (
  filesystem: FilesystemPort,
  canonicalRoot: string,
  relativePath: string,
  listedFilePaths: readonly string[],
) =>
  Effect.gen(function* () {
    const requestedPath = filesystem.join(canonicalRoot, relativePath);
    const canonicalPath = yield* filesystem.canonicalize(requestedPath).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileAccessError({
            code: "unavailable_file",
            field: "relativePath",
            message: `Unable to resolve file '${relativePath}'.`,
            details: { rootPath: canonicalRoot, relativePath },
            cause,
          }),
      ),
    );
    if (!isContainedPath(filesystem, canonicalRoot, canonicalPath)) {
      return yield* Effect.fail(
        new WorkspaceFileAccessError({
          code: "path_escape",
          field: "relativePath",
          message: `File '${relativePath}' is outside the selected workspace root.`,
          details: { rootPath: canonicalRoot, relativePath },
        }),
      );
    }
    const canonicalTargetIsListed = listedFilePaths.some(
      (listedPath) =>
        filesystem.relative(filesystem.join(canonicalRoot, listedPath), canonicalPath) === "",
    );
    if (!canonicalTargetIsListed) {
      return yield* Effect.fail(
        new WorkspaceFileAccessError({
          code: "unavailable_file",
          field: "relativePath",
          message: `File '${relativePath}' target is not available in the workspace file tree.`,
          details: { rootPath: canonicalRoot, relativePath },
        }),
      );
    }
    return canonicalPath;
  });
