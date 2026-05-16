import { rm } from "node:fs/promises";
import path from "node:path";
import type { FileDiff, GitResetWorktreeSelection } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  HostOperationError,
  HostResourceError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import {
  combineOutput,
  type GitCommandRunner,
  requireNonEmpty,
  runGitAllowFailure,
  runGitWithStdinAllowFailure,
} from "./git-command-runner";
import {
  combinePatchHunk,
  findMatchingCachedHunk,
  parsePatchHunks,
  type RenamePaths,
} from "./git-patch";

const gitOperationError = (message: string, operation: string): HostOperationError =>
  new HostOperationError({ message, operation });
const gitResourceError = (
  message: string,
  operation: string,
  resource: string,
): HostResourceError => new HostResourceError({ message, operation, resource });
const gitValidationError = (message: string, field: string): HostValidationError =>
  new HostValidationError({ message, field });
export const findFileDiff = (fileDiffs: FileDiff[], filePath: string): FileDiff => {
  const fileDiff = fileDiffs.find((diff) => diff.file === filePath);
  if (!fileDiff) {
    throw gitResourceError(
      "Displayed diff is stale. Refresh and try again.",
      "git.reset-worktree-selection",
      filePath,
    );
  }
  return fileDiff;
};
export const isTrackedPath = (
  runner: GitCommandRunner,
  workingDirectory: string,
  filePath: string,
) =>
  Effect.gen(function* () {
    const result = yield* runGitAllowFailure(runner, workingDirectory, [
      "ls-files",
      "--error-unmatch",
      "--",
      filePath,
    ]);
    if (result.ok) {
      return true;
    }
    const output = combineOutput(result.stdout, result.stderr);
    if (output.includes("did not match any file") || output.includes("error: pathspec")) {
      return false;
    }
    throw gitOperationError(output, "git.ls-files");
  });
export const runGitApplyReverse = (
  runner: GitCommandRunner,
  workingDirectory: string,
  patch: string,
  target: "worktree" | "cached",
  checkOnly: boolean,
) =>
  Effect.gen(function* () {
    const args = ["apply", "--reverse"];
    if (target === "cached") {
      args.push("--cached");
    }
    if (checkOnly) {
      args.push("--check");
    }
    args.push("-");
    const result = yield* runGitWithStdinAllowFailure(runner, workingDirectory, args, patch);
    if (!result.ok) {
      throw gitOperationError(combineOutput(result.stdout, result.stderr), "git.apply-reverse");
    }
  });
export const loadCachedPatch = (
  runner: GitCommandRunner,
  workingDirectory: string,
  filePath: string,
) =>
  Effect.gen(function* () {
    const result = yield* runGitAllowFailure(runner, workingDirectory, [
      "diff",
      "--cached",
      "--",
      filePath,
    ]);
    if (result.ok) {
      return result.stdout;
    }
    throw gitOperationError(combineOutput(result.stdout, result.stderr), "git.diff.cached");
  });
export const loadUnstagedPatch = (
  runner: GitCommandRunner,
  workingDirectory: string,
  filePath: string,
) =>
  Effect.gen(function* () {
    const result = yield* runGitAllowFailure(runner, workingDirectory, ["diff", "--", filePath]);
    if (result.ok) {
      return result.stdout;
    }
    throw gitOperationError(combineOutput(result.stdout, result.stderr), "git.diff.unstaged");
  });
export const resetRenamedFileSelection = (
  runner: GitCommandRunner,
  workingDirectory: string,
  renamePaths: RenamePaths,
) =>
  Effect.gen(function* () {
    const restoreResult = yield* runGitAllowFailure(runner, workingDirectory, [
      "restore",
      "--source=HEAD",
      "--staged",
      "--worktree",
      "--",
      renamePaths.oldPath,
    ]);
    if (!restoreResult.ok) {
      throw gitOperationError(
        combineOutput(restoreResult.stdout, restoreResult.stderr),
        "git.restore-renamed-file",
      );
    }
    const removeResult = yield* runGitAllowFailure(runner, workingDirectory, [
      "rm",
      "--force",
      "--cached",
      "--ignore-unmatch",
      "--",
      renamePaths.newPath,
    ]);
    if (!removeResult.ok) {
      throw gitOperationError(
        combineOutput(removeResult.stdout, removeResult.stderr),
        "git.rm-renamed-file",
      );
    }
    yield* Effect.tryPromise({
      try: () =>
        rm(path.join(workingDirectory, renamePaths.newPath), { recursive: true, force: true }),
      catch: (cause) =>
        toHostOperationError(cause, "git.resetRenamedFileSelection.rm", {
          path: renamePaths.newPath,
          workingDirectory,
        }),
    });
    return { affectedPaths: [renamePaths.oldPath, renamePaths.newPath] };
  });
export const resetFileSelection = (
  runner: GitCommandRunner,
  workingDirectory: string,
  fileDiffs: FileDiff[],
  filePath: string,
) =>
  Effect.gen(function* () {
    const normalizedFile = requireNonEmpty(filePath, "file path");
    const fileDiff = findFileDiff(fileDiffs, normalizedFile);
    if (fileDiff.type === "renamed") {
      const parsedPatch = parsePatchHunks(fileDiff.diff);
      if (!parsedPatch.renamePaths) {
        throw gitValidationError(
          `Cannot reset renamed file ${normalizedFile} because rename metadata is unavailable.`,
          "renamePaths",
        );
      }
      return yield* resetRenamedFileSelection(runner, workingDirectory, parsedPatch.renamePaths);
    }
    const result = (yield* isTrackedPath(runner, workingDirectory, normalizedFile))
      ? yield* runGitAllowFailure(runner, workingDirectory, [
          "restore",
          "--source=HEAD",
          "--staged",
          "--worktree",
          "--",
          normalizedFile,
        ])
      : yield* runGitAllowFailure(runner, workingDirectory, ["clean", "-f", "--", normalizedFile]);
    if (!result.ok) {
      throw gitOperationError(
        combineOutput(result.stdout, result.stderr),
        "git.reset-file-selection",
      );
    }
    return { affectedPaths: [normalizedFile] };
  });
export const resetHunkSelection = (
  runner: GitCommandRunner,
  workingDirectory: string,
  fileDiffs: FileDiff[],
  filePath: string,
  hunkIndex: number,
) =>
  Effect.gen(function* () {
    const normalizedFile = requireNonEmpty(filePath, "file path");
    const fileDiff = findFileDiff(fileDiffs, normalizedFile);
    if (!fileDiff.diff.trim()) {
      throw gitValidationError(
        `Cannot reset hunk because diff content is unavailable for ${normalizedFile}.`,
        "diff",
      );
    }
    if (fileDiff.type === "renamed") {
      throw gitValidationError(
        "Cannot reset an individual hunk for a renamed file. Reset the whole file instead.",
        "filePath",
      );
    }
    const parsedPatch = parsePatchHunks(fileDiff.diff);
    if (parsedPatch.renamePaths) {
      throw gitValidationError(
        "Cannot reset an individual hunk for a renamed file. Reset the whole file instead.",
        "filePath",
      );
    }
    const selectedHunk = parsedPatch.hunks[hunkIndex];
    if (!selectedHunk) {
      throw gitResourceError(
        `Requested hunk ${hunkIndex} does not exist for ${normalizedFile}.`,
        "git.reset-hunk-selection",
        normalizedFile,
      );
    }
    const worktreePatch = combinePatchHunk(parsedPatch.header, selectedHunk);
    yield* runGitApplyReverse(runner, workingDirectory, worktreePatch, "worktree", true);
    const cachedPatchText = yield* loadCachedPatch(runner, workingDirectory, normalizedFile);
    const unstagedPatchText = yield* loadUnstagedPatch(runner, workingDirectory, normalizedFile);
    let cachedReversePatch: string | undefined;
    if (cachedPatchText.trim()) {
      if (!unstagedPatchText.trim()) {
        yield* runGitApplyReverse(runner, workingDirectory, worktreePatch, "cached", true);
        cachedReversePatch = worktreePatch;
      } else {
        const cachedPatch = parsePatchHunks(cachedPatchText);
        if (cachedPatch.renamePaths) {
          throw gitValidationError(
            "Cannot reset an individual hunk for a renamed file while staged changes are present. Reset the whole file instead.",
            "filePath",
          );
        }
        const cachedHunk = findMatchingCachedHunk(cachedPatch, selectedHunk);
        if (cachedHunk) {
          const patch = combinePatchHunk(cachedPatch.header, cachedHunk);
          yield* runGitApplyReverse(runner, workingDirectory, patch, "cached", true);
          cachedReversePatch = patch;
        }
      }
    }
    if (cachedReversePatch) {
      yield* runGitApplyReverse(runner, workingDirectory, cachedReversePatch, "cached", false);
    }
    yield* runGitApplyReverse(runner, workingDirectory, worktreePatch, "worktree", false);
    return { affectedPaths: [normalizedFile] };
  });
export const resetWorktreeSelection = (
  runner: GitCommandRunner,
  workingDirectory: string,
  fileDiffs: FileDiff[],
  selection: GitResetWorktreeSelection,
) => {
  if (selection.kind === "file") {
    return resetFileSelection(runner, workingDirectory, fileDiffs, selection.filePath);
  }
  return resetHunkSelection(
    runner,
    workingDirectory,
    fileDiffs,
    selection.filePath,
    selection.hunkIndex,
  );
};
