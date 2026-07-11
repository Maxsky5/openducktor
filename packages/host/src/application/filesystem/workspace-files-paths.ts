import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { FilesystemPort } from "../../ports/filesystem-port";

const isWindowsAbsolutePathLike = (value: string): boolean =>
  value.startsWith("\\\\") || /^[a-zA-Z]:[\\/]/u.test(value);

const isAbsolutePathLike = (value: string): boolean =>
  value.startsWith("/") || isWindowsAbsolutePathLike(value);

export const requireRelativePath = (
  relativePath: string,
): Effect.Effect<string, HostValidationError> => {
  if (relativePath.trim().length === 0) {
    return Effect.fail(
      new HostValidationError({
        field: "relativePath",
        message: "File path is required.",
      }),
    );
  }
  if (isAbsolutePathLike(relativePath)) {
    return Effect.fail(
      new HostValidationError({
        field: "relativePath",
        message: "File path must be relative to the selected workspace root.",
        details: { relativePath },
      }),
    );
  }
  return Effect.succeed(relativePath);
};

export const isContainedPath = (
  filesystem: FilesystemPort,
  canonicalRoot: string,
  canonicalCandidate: string,
): boolean => {
  const relative = filesystem.relative(canonicalRoot, canonicalCandidate);
  const firstSegment = relative.split(/[\\/]/, 1)[0];
  return relative === "" || (firstSegment !== ".." && !isAbsolutePathLike(relative));
};

export const toWorkspaceRelativeGitPath = (
  filesystem: FilesystemPort,
  repositoryRoot: string,
  workspaceRoot: string,
  repositoryRelativePath: string,
): string | null => {
  const absolutePath = filesystem.join(repositoryRoot, repositoryRelativePath);
  if (!isContainedPath(filesystem, workspaceRoot, absolutePath)) {
    return null;
  }
  const relativePath = filesystem.relative(workspaceRoot, absolutePath);
  return isWindowsAbsolutePathLike(workspaceRoot)
    ? relativePath.replaceAll("\\", "/")
    : relativePath;
};
