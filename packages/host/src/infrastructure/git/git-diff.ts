import { stat } from "node:fs/promises";
import path from "node:path";
import type { FileDiff, FileStatus } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  HostOperationError,
  HostResourceError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import {
  combineOutput,
  type GitCommandResult,
  type GitCommandRunner,
  requireNonEmptyEffect,
  runGit,
  runGitAllowFailure,
} from "./git-command-runner";

const gitOperationError = (message: string, operation: string): HostOperationError =>
  new HostOperationError({ message, operation });
const gitResourceError = (
  message: string,
  operation: string,
  resource: string,
): HostResourceError => new HostResourceError({ message, operation, resource });
const gitValidationError = (message: string, field: string): HostValidationError =>
  new HostValidationError({ message, field });
type GitDiffError = HostOperationError | HostResourceError | HostValidationError;
const emptyTreeSha1 = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const emptyTreeSha256 = "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321";
const normalizeNumstatFilePath = (file: string): string => {
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
const parseNumstat = (
  output: string,
): Map<
  string,
  {
    additions: number;
    deletions: number;
  }
> => {
  const stats = new Map<
    string,
    {
      additions: number;
      deletions: number;
    }
  >();
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
):
  | {
      token: string;
      remaining: string;
    }
  | undefined => {
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
const parseDiffGitNewPath = (line: string): string | undefined => {
  const rest = line.slice("diff --git ".length);
  const oldPath = parseDiffGitHeaderToken(rest);
  if (!oldPath) {
    return undefined;
  }
  const newPath = parseDiffGitHeaderToken(oldPath.remaining);
  return newPath?.token.startsWith("b/") ? newPath.token.slice(2) : undefined;
};
const splitDiffByFile = (
  fullDiff: string,
): Array<{
  file: string;
  diff: string;
}> => {
  const results: Array<{
    file: string;
    diff: string;
  }> = [];
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
const inferDiffType = (diff: string): string => {
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
const ensureNoIndexDiffOutput = (
  result: GitCommandResult & {
    ok: boolean;
  },
  commandDescription: string,
): Effect.Effect<string, HostOperationError> => {
  if (result.ok || result.stdout.trim().length > 0) {
    return Effect.succeed(result.stdout);
  }
  return Effect.fail(
    gitOperationError(
      `${commandDescription} failed: ${combineOutput(result.stdout, result.stderr)}`,
      commandDescription,
    ),
  );
};
const loadNoIndexDiffPayload = (
  runner: GitCommandRunner,
  workingDirectory: string,
  filePath: string,
): Effect.Effect<
  {
    numstat: string;
    diff: string;
  },
  GitDiffError
> =>
  Effect.gen(function* () {
    const numstatResult = yield* runGitAllowFailure(runner, workingDirectory, [
      "diff",
      "--no-index",
      "--numstat",
      "--",
      "/dev/null",
      filePath,
    ]);
    const diffResult = yield* runGitAllowFailure(runner, workingDirectory, [
      "diff",
      "--no-index",
      "--",
      "/dev/null",
      filePath,
    ]);
    return {
      numstat: yield* ensureNoIndexDiffOutput(
        numstatResult,
        `git diff --no-index --numstat /dev/null ${filePath}`,
      ),
      diff: yield* ensureNoIndexDiffOutput(diffResult, `git diff --no-index /dev/null ${filePath}`),
    };
  });
const expandUntrackedStatusPaths = (
  runner: GitCommandRunner,
  workingDirectory: string,
  statusPath: string,
) =>
  Effect.gen(function* () {
    const trimmedPath = statusPath.trim();
    if (!trimmedPath) {
      return [];
    }
    const pathStats = yield* Effect.tryPromise({
      try: () => stat(path.join(workingDirectory, trimmedPath)),
      catch: (cause) =>
        toHostOperationError(cause, "git.expandUntrackedStatusPaths.stat", {
          statusPath: trimmedPath,
          workingDirectory,
        }),
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    if (!pathStats?.isDirectory()) {
      return [trimmedPath];
    }
    const result = yield* runGitAllowFailure(runner, workingDirectory, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      trimmedPath,
    ]);
    if (!result.ok) {
      return yield* Effect.fail(
        gitOperationError(
          `git ls-files --others --exclude-standard -- ${trimmedPath} failed: ${combineOutput(result.stdout, result.stderr)}`,
          "git.ls-files",
        ),
      );
    }
    const filePaths = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (filePaths.length === 0) {
      return yield* Effect.fail(
        gitResourceError(
          `git ls-files --others --exclude-standard -- ${trimmedPath} returned no files`,
          "git.ls-files",
          trimmedPath,
        ),
      );
    }
    return filePaths;
  });
export const buildFileDiffs = (
  runner: GitCommandRunner,
  workingDirectory: string,
  fileStatuses: FileStatus[],
  numstatOutput: string,
  diffOutput: string,
): Effect.Effect<FileDiff[], GitDiffError> =>
  Effect.gen(function* () {
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
      for (const filePath of yield* expandUntrackedStatusPaths(
        runner,
        workingDirectory,
        status.path,
      )) {
        if (filesWithDiffs.has(filePath)) {
          continue;
        }
        const payload = yield* loadNoIndexDiffPayload(runner, workingDirectory, filePath);
        const [untrackedDiff] = yield* buildFileDiffs(
          runner,
          workingDirectory,
          [],
          payload.numstat,
          payload.diff,
        );
        if (!untrackedDiff || untrackedDiff.file !== filePath) {
          return yield* Effect.fail(
            gitResourceError(
              `git diff --no-index produced no matching diff entry for ${filePath}`,
              "git.diff.no-index",
              filePath,
            ),
          );
        }
        results.push(untrackedDiff);
        filesWithDiffs.add(filePath);
      }
    }
    results.sort((left, right) => left.file.localeCompare(right.file));
    return results;
  });
export const loadDiffPayload = (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch?: string,
): Effect.Effect<
  {
    numstat: string;
    diff: string;
  },
  GitDiffError
> =>
  Effect.gen(function* () {
    const target = targetBranch?.trim() || "HEAD";
    const numstatResult = yield* runGitAllowFailure(runner, workingDirectory, [
      "diff",
      "--numstat",
      "--end-of-options",
      target,
    ]);
    if (!numstatResult.ok) {
      return yield* Effect.fail(
        gitOperationError(
          `git diff --numstat ${target} failed: ${combineOutput(numstatResult.stdout, numstatResult.stderr)}`,
          "git.diff.numstat",
        ),
      );
    }
    const diffResult = yield* runGitAllowFailure(runner, workingDirectory, [
      "diff",
      "--end-of-options",
      target,
    ]);
    if (!diffResult.ok) {
      return yield* Effect.fail(
        gitOperationError(
          `git diff ${target} failed: ${combineOutput(diffResult.stdout, diffResult.stderr)}`,
          "git.diff",
        ),
      );
    }
    return { numstat: numstatResult.stdout, diff: diffResult.stdout };
  });
const emptyTreeOid = (
  runner: GitCommandRunner,
  workingDirectory: string,
): Effect.Effect<string, HostOperationError | HostValidationError> =>
  Effect.gen(function* () {
    const objectFormat = (yield* runGit(runner, workingDirectory, [
      "rev-parse",
      "--show-object-format",
    ])).trim();
    if (objectFormat === "sha1") {
      return emptyTreeSha1;
    }
    if (objectFormat === "sha256") {
      return emptyTreeSha256;
    }
    return yield* Effect.fail(
      gitValidationError(
        `Unsupported git object format for empty tree branch diff base: ${objectFormat}`,
        "objectFormat",
      ),
    );
  });
const resolveBranchDiffBase = (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch: string,
): Effect.Effect<string, GitDiffError> =>
  Effect.gen(function* () {
    const target = yield* requireNonEmptyEffect(targetBranch, "target branch");
    const result = yield* runGitAllowFailure(runner, workingDirectory, [
      "merge-base",
      "--end-of-options",
      target,
      "HEAD",
    ]);
    if (!result.ok) {
      if (!result.stdout.trim() && !result.stderr.trim()) {
        return yield* emptyTreeOid(runner, workingDirectory);
      }
      return yield* Effect.fail(
        gitOperationError(
          `git merge-base ${target} HEAD failed for target branch '${target}': ${combineOutput(result.stdout, result.stderr)}`,
          "git.merge-base",
        ),
      );
    }
    const mergeBase = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (!mergeBase) {
      return yield* Effect.fail(
        gitResourceError(
          `git merge-base ${target} HEAD returned no merge base`,
          "git.merge-base",
          target,
        ),
      );
    }
    return mergeBase;
  });
export const loadBranchChangesDiffPayload = (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch: string,
): Effect.Effect<
  {
    numstat: string;
    diff: string;
  },
  GitDiffError
> =>
  Effect.gen(function* () {
    const diffBase = yield* resolveBranchDiffBase(runner, workingDirectory, targetBranch);
    return yield* loadDiffPayload(runner, workingDirectory, diffBase);
  });
