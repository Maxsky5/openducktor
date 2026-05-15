import { rm } from "node:fs/promises";
import path from "node:path";
import type {
  FileDiff,
  GitResetWorktreeSelection,
  GitResetWorktreeSelectionResult,
} from "@openducktor/contracts";
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

export const findFileDiff = (fileDiffs: FileDiff[], filePath: string): FileDiff => {
  const fileDiff = fileDiffs.find((diff) => diff.file === filePath);
  if (!fileDiff) {
    throw new Error("Displayed diff is stale. Refresh and try again.");
  }

  return fileDiff;
};

export const isTrackedPath = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  filePath: string,
): Promise<boolean> => {
  const result = await runGitAllowFailure(runner, workingDirectory, [
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

  throw new Error(output);
};

export const runGitApplyReverse = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  patch: string,
  target: "worktree" | "cached",
  checkOnly: boolean,
): Promise<void> => {
  const args = ["apply", "--reverse"];
  if (target === "cached") {
    args.push("--cached");
  }
  if (checkOnly) {
    args.push("--check");
  }
  args.push("-");

  const result = await runGitWithStdinAllowFailure(runner, workingDirectory, args, patch);
  if (!result.ok) {
    throw new Error(combineOutput(result.stdout, result.stderr));
  }
};

export const loadCachedPatch = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  filePath: string,
): Promise<string> => {
  const result = await runGitAllowFailure(runner, workingDirectory, [
    "diff",
    "--cached",
    "--",
    filePath,
  ]);
  if (result.ok) {
    return result.stdout;
  }

  throw new Error(combineOutput(result.stdout, result.stderr));
};

export const loadUnstagedPatch = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  filePath: string,
): Promise<string> => {
  const result = await runGitAllowFailure(runner, workingDirectory, ["diff", "--", filePath]);
  if (result.ok) {
    return result.stdout;
  }

  throw new Error(combineOutput(result.stdout, result.stderr));
};

export const resetRenamedFileSelection = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  renamePaths: RenamePaths,
): Promise<GitResetWorktreeSelectionResult> => {
  const restoreResult = await runGitAllowFailure(runner, workingDirectory, [
    "restore",
    "--source=HEAD",
    "--staged",
    "--worktree",
    "--",
    renamePaths.oldPath,
  ]);
  if (!restoreResult.ok) {
    throw new Error(combineOutput(restoreResult.stdout, restoreResult.stderr));
  }

  const removeResult = await runGitAllowFailure(runner, workingDirectory, [
    "rm",
    "--force",
    "--cached",
    "--ignore-unmatch",
    "--",
    renamePaths.newPath,
  ]);
  if (!removeResult.ok) {
    throw new Error(combineOutput(removeResult.stdout, removeResult.stderr));
  }

  await rm(path.join(workingDirectory, renamePaths.newPath), { recursive: true, force: true });
  return { affectedPaths: [renamePaths.oldPath, renamePaths.newPath] };
};

export const resetFileSelection = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  fileDiffs: FileDiff[],
  filePath: string,
): Promise<GitResetWorktreeSelectionResult> => {
  const normalizedFile = requireNonEmpty(filePath, "file path");
  const fileDiff = findFileDiff(fileDiffs, normalizedFile);

  if (fileDiff.type === "renamed") {
    const parsedPatch = parsePatchHunks(fileDiff.diff);
    if (!parsedPatch.renamePaths) {
      throw new Error(
        `Cannot reset renamed file ${normalizedFile} because rename metadata is unavailable.`,
      );
    }
    return resetRenamedFileSelection(runner, workingDirectory, parsedPatch.renamePaths);
  }

  const result = (await isTrackedPath(runner, workingDirectory, normalizedFile))
    ? await runGitAllowFailure(runner, workingDirectory, [
        "restore",
        "--source=HEAD",
        "--staged",
        "--worktree",
        "--",
        normalizedFile,
      ])
    : await runGitAllowFailure(runner, workingDirectory, ["clean", "-f", "--", normalizedFile]);
  if (!result.ok) {
    throw new Error(combineOutput(result.stdout, result.stderr));
  }

  return { affectedPaths: [normalizedFile] };
};

export const resetHunkSelection = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  fileDiffs: FileDiff[],
  filePath: string,
  hunkIndex: number,
): Promise<GitResetWorktreeSelectionResult> => {
  const normalizedFile = requireNonEmpty(filePath, "file path");
  const fileDiff = findFileDiff(fileDiffs, normalizedFile);
  if (!fileDiff.diff.trim()) {
    throw new Error(`Cannot reset hunk because diff content is unavailable for ${normalizedFile}.`);
  }
  if (fileDiff.type === "renamed") {
    throw new Error(
      "Cannot reset an individual hunk for a renamed file. Reset the whole file instead.",
    );
  }

  const parsedPatch = parsePatchHunks(fileDiff.diff);
  if (parsedPatch.renamePaths) {
    throw new Error(
      "Cannot reset an individual hunk for a renamed file. Reset the whole file instead.",
    );
  }

  const selectedHunk = parsedPatch.hunks[hunkIndex];
  if (!selectedHunk) {
    throw new Error(`Requested hunk ${hunkIndex} does not exist for ${normalizedFile}.`);
  }

  const worktreePatch = combinePatchHunk(parsedPatch.header, selectedHunk);
  await runGitApplyReverse(runner, workingDirectory, worktreePatch, "worktree", true);

  const cachedPatchText = await loadCachedPatch(runner, workingDirectory, normalizedFile);
  const unstagedPatchText = await loadUnstagedPatch(runner, workingDirectory, normalizedFile);
  let cachedReversePatch: string | undefined;
  if (cachedPatchText.trim()) {
    if (!unstagedPatchText.trim()) {
      await runGitApplyReverse(runner, workingDirectory, worktreePatch, "cached", true);
      cachedReversePatch = worktreePatch;
    } else {
      const cachedPatch = parsePatchHunks(cachedPatchText);
      if (cachedPatch.renamePaths) {
        throw new Error(
          "Cannot reset an individual hunk for a renamed file while staged changes are present. Reset the whole file instead.",
        );
      }

      const cachedHunk = findMatchingCachedHunk(cachedPatch, selectedHunk);
      if (cachedHunk) {
        const patch = combinePatchHunk(cachedPatch.header, cachedHunk);
        await runGitApplyReverse(runner, workingDirectory, patch, "cached", true);
        cachedReversePatch = patch;
      }
    }
  }

  if (cachedReversePatch) {
    await runGitApplyReverse(runner, workingDirectory, cachedReversePatch, "cached", false);
  }
  await runGitApplyReverse(runner, workingDirectory, worktreePatch, "worktree", false);

  return { affectedPaths: [normalizedFile] };
};

export const resetWorktreeSelection = (
  runner: GitCommandRunner,
  workingDirectory: string,
  fileDiffs: FileDiff[],
  selection: GitResetWorktreeSelection,
): Promise<GitResetWorktreeSelectionResult> => {
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
