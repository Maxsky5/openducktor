import { stat } from "node:fs/promises";
import path from "node:path";
import type { FileDiff, FileStatus } from "@openducktor/contracts";
import {
  combineOutput,
  type GitCommandResult,
  type GitCommandRunner,
  requireNonEmpty,
  runGit,
  runGitAllowFailure,
} from "./git-command-runner";

export const upstreamTargetBranch = "@{upstream}";
export const emptyTreeSha1 = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
export const emptyTreeSha256 = "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321";

export const normalizeNumstatFilePath = (file: string): string => {
  let normalized = file.trim();

  while (true) {
    const start = normalized.indexOf("{");
    if (start < 0) {
      break;
    }

    const end = normalized.indexOf("}", start);
    if (end < 0) {
      break;
    }

    const segment = normalized.slice(start + 1, end);
    const [, replacement] = segment.split(" => ", 2);
    if (!replacement) {
      break;
    }

    normalized = `${normalized.slice(0, start)}${replacement}${normalized.slice(end + 1)}`;
  }

  const addedPrefix = "/dev/null => ";
  if (normalized.startsWith(addedPrefix)) {
    return normalized.slice(addedPrefix.length);
  }

  const deletedSuffix = " => /dev/null";
  if (normalized.endsWith(deletedSuffix)) {
    return normalized.slice(0, -deletedSuffix.length);
  }

  if (normalized.includes(" => ")) {
    const parts = normalized.split(" => ");
    return parts.at(-1) || parts.at(0) || normalized;
  }

  return normalized;
};

export const parseNumstat = (
  output: string,
): Map<string, { additions: number; deletions: number }> => {
  const stats = new Map<string, { additions: number; deletions: number }>();

  for (const line of output.split(/\r?\n/)) {
    const parts = line.split("\t");
    if (parts.length < 3) {
      continue;
    }

    stats.set(normalizeNumstatFilePath(parts.slice(2).join("\t")), {
      additions: Number.parseInt(parts[0] ?? "", 10) || 0,
      deletions: Number.parseInt(parts[1] ?? "", 10) || 0,
    });
  }

  return stats;
};

export const parseDiffGitHeaderToken = (
  input: string,
): { token: string; remaining: string } | undefined => {
  const trimmed = input.trimStart();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith('"')) {
    let escaped = false;
    for (let index = 1; index < trimmed.length; index += 1) {
      const character = trimmed[index];
      if (character === '"' && !escaped) {
        return {
          token: trimmed.slice(1, index),
          remaining: trimmed.slice(index + 1),
        };
      }

      escaped = character === "\\" && !escaped;
      if (character !== "\\") {
        escaped = false;
      }
    }

    return undefined;
  }

  const tokenEnd = trimmed.indexOf(" ");
  if (tokenEnd < 0) {
    return { token: trimmed, remaining: "" };
  }

  return { token: trimmed.slice(0, tokenEnd), remaining: trimmed.slice(tokenEnd) };
};

export const parseDiffGitNewPath = (line: string): string | undefined => {
  const rest = line.slice("diff --git ".length);
  const oldPath = parseDiffGitHeaderToken(rest);
  if (!oldPath) {
    return undefined;
  }

  const newPath = parseDiffGitHeaderToken(oldPath.remaining);
  return newPath?.token.startsWith("b/") ? newPath.token.slice(2) : undefined;
};

export const splitDiffByFile = (fullDiff: string): Array<{ file: string; diff: string }> => {
  const results: Array<{ file: string; diff: string }> = [];
  let currentFile: string | undefined;
  let currentDiff = "";

  for (const line of fullDiff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      if (currentFile) {
        results.push({ file: currentFile, diff: currentDiff });
      }

      currentFile = parseDiffGitNewPath(line) ?? "";
      currentDiff = `${line}\n`;
      continue;
    }

    currentDiff += `${line}\n`;
  }

  if (currentFile) {
    results.push({ file: currentFile, diff: currentDiff });
  }

  return results;
};

export const inferDiffType = (diff: string): string => {
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("new file mode")) {
      return "added";
    }
    if (line.startsWith("deleted file mode")) {
      return "deleted";
    }
    if (line.startsWith("rename from")) {
      return "renamed";
    }
  }

  return "modified";
};

export const ensureNoIndexDiffOutput = (
  result: GitCommandResult & { ok: boolean },
  commandDescription: string,
): string => {
  if (result.ok || result.stdout.trim().length > 0) {
    return result.stdout;
  }

  throw new Error(`${commandDescription} failed: ${combineOutput(result.stdout, result.stderr)}`);
};

export const loadNoIndexDiffPayload = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  filePath: string,
): Promise<{ numstat: string; diff: string }> => {
  const numstatResult = await runGitAllowFailure(runner, workingDirectory, [
    "diff",
    "--no-index",
    "--numstat",
    "--",
    "/dev/null",
    filePath,
  ]);
  const diffResult = await runGitAllowFailure(runner, workingDirectory, [
    "diff",
    "--no-index",
    "--",
    "/dev/null",
    filePath,
  ]);

  return {
    numstat: ensureNoIndexDiffOutput(
      numstatResult,
      `git diff --no-index --numstat /dev/null ${filePath}`,
    ),
    diff: ensureNoIndexDiffOutput(diffResult, `git diff --no-index /dev/null ${filePath}`),
  };
};

export const expandUntrackedStatusPaths = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  statusPath: string,
): Promise<string[]> => {
  const trimmedPath = statusPath.trim();
  if (!trimmedPath) {
    return [];
  }

  const pathStats = await stat(path.join(workingDirectory, trimmedPath)).catch(() => undefined);
  if (!pathStats?.isDirectory()) {
    return [trimmedPath];
  }

  const result = await runGitAllowFailure(runner, workingDirectory, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    trimmedPath,
  ]);
  if (!result.ok) {
    throw new Error(
      `git ls-files --others --exclude-standard -- ${trimmedPath} failed: ${combineOutput(
        result.stdout,
        result.stderr,
      )}`,
    );
  }

  const filePaths = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (filePaths.length === 0) {
    throw new Error(`git ls-files --others --exclude-standard -- ${trimmedPath} returned no files`);
  }

  return filePaths;
};

export const buildFileDiffs = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  fileStatuses: FileStatus[],
  numstatOutput: string,
  diffOutput: string,
): Promise<FileDiff[]> => {
  const stats = parseNumstat(numstatOutput);
  const fileDiffs = splitDiffByFile(diffOutput);
  const results: FileDiff[] = fileDiffs.map(({ file, diff }) => {
    const fileStats = stats.get(file) ?? { additions: 0, deletions: 0 };
    return {
      file,
      type: inferDiffType(diff),
      additions: fileStats.additions,
      deletions: fileStats.deletions,
      diff,
    };
  });

  const filesWithDiffs = new Set(results.map((entry) => entry.file));
  for (const [file, fileStats] of stats) {
    if (!filesWithDiffs.has(file)) {
      results.push({
        file,
        type: "modified",
        additions: fileStats.additions,
        deletions: fileStats.deletions,
        diff: "",
      });
      filesWithDiffs.add(file);
    }
  }

  for (const status of fileStatuses) {
    if (status.status !== "untracked") {
      continue;
    }

    for (const filePath of await expandUntrackedStatusPaths(
      runner,
      workingDirectory,
      status.path,
    )) {
      if (filesWithDiffs.has(filePath)) {
        continue;
      }

      const payload = await loadNoIndexDiffPayload(runner, workingDirectory, filePath);
      const [untrackedDiff] = await buildFileDiffs(
        runner,
        workingDirectory,
        [],
        payload.numstat,
        payload.diff,
      );
      if (!untrackedDiff || untrackedDiff.file !== filePath) {
        throw new Error(`git diff --no-index produced no matching diff entry for ${filePath}`);
      }

      results.push(untrackedDiff);
      filesWithDiffs.add(filePath);
    }
  }

  results.sort((left, right) => left.file.localeCompare(right.file));
  return results;
};

export const loadDiffPayload = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch?: string,
): Promise<{ numstat: string; diff: string }> => {
  const target = targetBranch?.trim() || "HEAD";
  const numstatResult = await runGitAllowFailure(runner, workingDirectory, [
    "diff",
    "--numstat",
    "--end-of-options",
    target,
  ]);
  if (!numstatResult.ok) {
    throw new Error(
      `git diff --numstat ${target} failed: ${combineOutput(
        numstatResult.stdout,
        numstatResult.stderr,
      )}`,
    );
  }

  const diffResult = await runGitAllowFailure(runner, workingDirectory, [
    "diff",
    "--end-of-options",
    target,
  ]);
  if (!diffResult.ok) {
    throw new Error(
      `git diff ${target} failed: ${combineOutput(diffResult.stdout, diffResult.stderr)}`,
    );
  }

  return { numstat: numstatResult.stdout, diff: diffResult.stdout };
};

export const emptyTreeOid = async (
  runner: GitCommandRunner,
  workingDirectory: string,
): Promise<string> => {
  const objectFormat = (
    await runGit(runner, workingDirectory, ["rev-parse", "--show-object-format"])
  ).trim();
  if (objectFormat === "sha1") {
    return emptyTreeSha1;
  }
  if (objectFormat === "sha256") {
    return emptyTreeSha256;
  }

  throw new Error(`Unsupported git object format for empty tree branch diff base: ${objectFormat}`);
};

export const resolveBranchDiffBase = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch: string,
): Promise<string> => {
  const target = requireNonEmpty(targetBranch, "target branch");
  const result = await runGitAllowFailure(runner, workingDirectory, [
    "merge-base",
    "--end-of-options",
    target,
    "HEAD",
  ]);
  if (!result.ok) {
    if (!result.stdout.trim() && !result.stderr.trim()) {
      return emptyTreeOid(runner, workingDirectory);
    }

    throw new Error(
      `git merge-base ${target} HEAD failed for target branch '${target}': ${combineOutput(
        result.stdout,
        result.stderr,
      )}`,
    );
  }

  const mergeBase = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!mergeBase) {
    throw new Error(`git merge-base ${target} HEAD returned no merge base`);
  }

  return mergeBase;
};

export const loadBranchChangesDiffPayload = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch: string,
): Promise<{ numstat: string; diff: string }> => {
  const diffBase = await resolveBranchDiffBase(runner, workingDirectory, targetBranch);
  return loadDiffPayload(runner, workingDirectory, diffBase);
};
