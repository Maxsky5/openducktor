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
  requireNonEmptyEffect,
  runGit,
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
const findFileDiff = (fileDiffs: FileDiff[], filePath: string): FileDiff => {
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
const findFileDiffEffect = (
  fileDiffs: FileDiff[],
  filePath: string,
): Effect.Effect<FileDiff, HostResourceError> =>
  Effect.try({
    try: () => findFileDiff(fileDiffs, filePath),
    catch: (cause) =>
      cause instanceof HostResourceError
        ? cause
        : gitResourceError(
            "Displayed diff is stale. Refresh and try again.",
            "git.reset",
            filePath,
          ),
  });
const parsePatchHunksEffect = (
  patch: string,
): Effect.Effect<ReturnType<typeof parsePatchHunks>, HostValidationError> =>
  Effect.try({
    try: () => parsePatchHunks(patch),
    catch: (cause) =>
      cause instanceof HostValidationError
        ? cause
        : gitValidationError(cause instanceof Error ? cause.message : String(cause), "patch"),
  });
const findMatchingCachedHunkEffect = (
  cachedPatch: ReturnType<typeof parsePatchHunks>,
  selectedHunk: ReturnType<typeof parsePatchHunks>["hunks"][number],
): Effect.Effect<ReturnType<typeof findMatchingCachedHunk>, HostValidationError> =>
  Effect.try({
    try: () => findMatchingCachedHunk(cachedPatch, selectedHunk),
    catch: (cause) =>
      cause instanceof HostValidationError
        ? cause
        : gitValidationError(cause instanceof Error ? cause.message : String(cause), "patch"),
  });
const isTrackedPath = (runner: GitCommandRunner, workingDirectory: string, filePath: string) =>
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
    return yield* Effect.fail(gitOperationError(output, "git.ls-files"));
  });
const runGitApplyReverse = (
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
      return yield* Effect.fail(
        gitOperationError(combineOutput(result.stdout, result.stderr), "git.apply-reverse"),
      );
    }
  });
const loadCachedPatch = (runner: GitCommandRunner, workingDirectory: string, filePath: string) =>
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
    return yield* Effect.fail(
      gitOperationError(combineOutput(result.stdout, result.stderr), "git.diff.cached"),
    );
  });
const loadUnstagedPatch = (runner: GitCommandRunner, workingDirectory: string, filePath: string) =>
  Effect.gen(function* () {
    const result = yield* runGitAllowFailure(runner, workingDirectory, ["diff", "--", filePath]);
    if (result.ok) {
      return result.stdout;
    }
    return yield* Effect.fail(
      gitOperationError(combineOutput(result.stdout, result.stderr), "git.diff.unstaged"),
    );
  });
const resetRenamedFileSelection = (
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
      return yield* Effect.fail(
        gitOperationError(
          combineOutput(restoreResult.stdout, restoreResult.stderr),
          "git.restore-renamed-file",
        ),
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
      return yield* Effect.fail(
        gitOperationError(
          combineOutput(removeResult.stdout, removeResult.stderr),
          "git.rm-renamed-file",
        ),
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
const resetFileSelection = (
  runner: GitCommandRunner,
  workingDirectory: string,
  fileDiffs: FileDiff[],
  filePath: string,
) =>
  Effect.gen(function* () {
    const normalizedFile = yield* requireNonEmptyEffect(filePath, "file path");
    const fileDiff = yield* findFileDiffEffect(fileDiffs, normalizedFile);
    if (fileDiff.type === "renamed") {
      const parsedPatch = yield* parsePatchHunksEffect(fileDiff.diff);
      if (!parsedPatch.renamePaths) {
        return yield* Effect.fail(
          gitValidationError(
            `Cannot reset renamed file ${normalizedFile} because rename metadata is unavailable.`,
            "renamePaths",
          ),
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
      return yield* Effect.fail(
        gitOperationError(combineOutput(result.stdout, result.stderr), "git.reset-file-selection"),
      );
    }
    return { affectedPaths: [normalizedFile] };
  });
const resetHunkSelection = (
  runner: GitCommandRunner,
  workingDirectory: string,
  fileDiffs: FileDiff[],
  filePath: string,
  hunkIndex: number,
) =>
  Effect.gen(function* () {
    const normalizedFile = yield* requireNonEmptyEffect(filePath, "file path");
    const fileDiff = yield* findFileDiffEffect(fileDiffs, normalizedFile);
    if (!fileDiff.diff.trim()) {
      return yield* Effect.fail(
        gitValidationError(
          `Cannot reset hunk because diff content is unavailable for ${normalizedFile}.`,
          "diff",
        ),
      );
    }
    if (fileDiff.type === "renamed") {
      return yield* Effect.fail(
        gitValidationError(
          "Cannot reset an individual hunk for a renamed file. Reset the whole file instead.",
          "filePath",
        ),
      );
    }
    const parsedPatch = yield* parsePatchHunksEffect(fileDiff.diff);
    if (parsedPatch.renamePaths) {
      return yield* Effect.fail(
        gitValidationError(
          "Cannot reset an individual hunk for a renamed file. Reset the whole file instead.",
          "filePath",
        ),
      );
    }
    const selectedHunk = parsedPatch.hunks[hunkIndex];
    if (!selectedHunk) {
      return yield* Effect.fail(
        gitResourceError(
          `Requested hunk ${hunkIndex} does not exist for ${normalizedFile}.`,
          "git.reset-hunk-selection",
          normalizedFile,
        ),
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
        const cachedPatch = yield* parsePatchHunksEffect(cachedPatchText);
        if (cachedPatch.renamePaths) {
          return yield* Effect.fail(
            gitValidationError(
              "Cannot reset an individual hunk for a renamed file while staged changes are present. Reset the whole file instead.",
              "filePath",
            ),
          );
        }
        const cachedHunk = yield* findMatchingCachedHunkEffect(cachedPatch, selectedHunk);
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

export const restoreWorktreeToReference = (
  runner: GitCommandRunner,
  workingDirectory: string,
  reference: string,
) =>
  Effect.gen(function* () {
    const targetReference = yield* requireNonEmptyEffect(reference, "reference");
    const resolvedCommit = yield* requireNonEmptyEffect(
      (yield* runGit(runner, workingDirectory, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${targetReference}^{commit}`,
      ])).trim(),
      "resolved reference",
    );
    yield* runGit(runner, workingDirectory, ["reset", "--hard", resolvedCommit]);
    const cleanup = yield* runGitAllowFailure(runner, workingDirectory, ["clean", "-d", "-f"]);
    if (!cleanup.ok) {
      return yield* Effect.fail(
        gitOperationError(
          `Tracked content was restored to ${targetReference}, but ordinary untracked-file cleanup did not complete: ${combineOutput(cleanup.stdout, cleanup.stderr)}`,
          "git.restore-worktree.clean-untracked",
        ),
      );
    }
  });
