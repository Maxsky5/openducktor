import { stat } from "node:fs/promises";
import path from "node:path";
import type { FileStatus, GitFileDiff, GitFileDiffType } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  HostOperationError,
  type HostOperationErrorAggregate,
  HostResourceError,
  type HostResourceErrorAggregate,
  HostValidationError,
  type HostValidationErrorAggregate,
  toHostOperationError,
} from "../../effect/host-errors";
import {
  combineOutput,
  type GitCommandRunner,
  requireNonEmptyEffect,
  runGit,
  runGitAllowFailure,
} from "./git-command-runner";
import { headerLinePath, unquoteGitPath } from "./git-quoted-path";

const gitOperationError = (message: string, operation: string): HostOperationError =>
  new HostOperationError({ message, operation });
const gitResourceError = (
  message: string,
  operation: string,
  resource: string,
): HostResourceError => new HostResourceError({ message, operation, resource });
const gitValidationError = (message: string, field: string): HostValidationError =>
  new HostValidationError({ message, field });
type GitDiffError =
  | HostOperationErrorAggregate
  | HostResourceErrorAggregate
  | HostValidationErrorAggregate;
const emptyTreeSha1 = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const emptyTreeSha256 = "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321";
type DiffStats = { additions: number; deletions: number };

/**
 * Reads `git diff --numstat -z`, which writes each path without quotes. A record is
 * `<added>\t<deleted>\t<path>\0`. A rename or a copy has an empty path, then
 * `<old path>\0<new path>\0`. A binary file counts `-` lines.
 */
const parseNumstat = (output: string): Map<string, DiffStats> => {
  const stats = new Map<string, DiffStats>();
  const fields = output.split("\0");
  for (let index = 0; index < fields.length; index += 1) {
    const record = /^(\d+|-)\t(\d+|-)\t(.*)$/su.exec(fields[index] ?? "");
    if (!record) continue;
    let file = record[3] ?? "";
    if (file === "") {
      file = fields[index + 2] ?? "";
      index += 2;
    }
    stats.set(file, {
      additions: Number.parseInt(record[1] ?? "", 10) || 0,
      deletions: Number.parseInt(record[2] ?? "", 10) || 0,
    });
  }
  return stats;
};

export type DiffGitHeaderToken = {
  remaining: string;
  token: string;
};

export const parseDiffGitHeaderToken = (input: string): DiffGitHeaderToken | undefined => {
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
          token: unquoteGitPath(trimmed.slice(1, index)),
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
/**
 * The new path of a `diff --git a/<old> b/<new>` line. Git quotes a path with special characters.
 * A bare path can hold spaces, so a bare line without a rename is split where both halves match.
 */
const parseDiffGitNewPath = (line: string): string | undefined => {
  const rest = line.slice("diff --git ".length);
  if (rest.startsWith('"')) {
    const oldPath = parseDiffGitHeaderToken(rest);
    const newPath = oldPath ? parseDiffGitHeaderToken(oldPath.remaining) : undefined;
    return newPath?.token.startsWith("b/") ? newPath.token.slice(2) : undefined;
  }
  const pathLength = (rest.length - "a/ b/".length) / 2;
  const newPath = rest.slice(rest.length - pathLength);
  return rest.startsWith("a/") &&
    rest.slice(2 + pathLength, 5 + pathLength) === " b/" &&
    rest.slice(2, 2 + pathLength) === newPath
    ? newPath
    : undefined;
};

/**
 * The new path of one file section. The `rename to` and `copy to` lines name the new path of a
 * rename or a copy, where the `diff --git` line holds two different paths.
 */
const sectionPath = (lines: string[]): string | undefined => {
  for (const line of lines.slice(1)) {
    if (line.startsWith("@@") || line.startsWith("--- ") || line.startsWith("Binary files ")) break;
    for (const prefix of ["rename to ", "copy to "]) {
      if (line.startsWith(prefix)) return headerLinePath(line.slice(prefix.length));
    }
  }
  return parseDiffGitNewPath(lines[0] ?? "");
};
const splitDiffByFile = (
  fullDiff: string,
): Array<{
  file: string;
  diff: string;
}> => {
  const sections: string[][] = [];
  for (const line of fullDiff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      sections.push([line]);
      continue;
    }
    sections.at(-1)?.push(line);
  }
  return sections.flatMap((lines) => {
    const file = sectionPath(lines);
    return file ? [{ file, diff: lines.map((line) => `${line}\n`).join("") }] : [];
  });
};
/** A header line that names a submodule entry, which has Git file mode 160000. */
const SUBMODULE_MODE_LINE =
  /^(?:index \S+|new file mode|deleted file mode|old mode|new mode) 160000$/mu;
/** A `--submodule=short` hunk line. A submodule with edits only inside it has no mode line. */
const SUBMODULE_COMMIT_LINE = /^[-+]Subproject commit [0-9a-f]+(?:-dirty)?$/mu;

const inferDiffType = (diff: string): GitFileDiffType => {
  if (SUBMODULE_MODE_LINE.test(diff) || SUBMODULE_COMMIT_LINE.test(diff)) return "submodule";
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
    // A copy is a new file in the index. A write reads it alone, as a whole new file.
    if (line.startsWith("copy from")) {
      return "added";
    }
  }
  return "modified";
};
const loadNoIndexDiffPayload = (
  runner: GitCommandRunner,
  workingDirectory: string,
  filePath: string,
  fullIndex: boolean,
): Effect.Effect<GitFileDiff, GitDiffError> =>
  Effect.gen(function* () {
    const result = yield* runGitAllowFailure(runner, workingDirectory, [
      "diff",
      "--no-index",
      "--numstat",
      "-z",
      "--patch",
      ...(fullIndex ? ["--full-index"] : []),
      "--",
      "/dev/null",
      filePath,
    ]);
    if (!result.ok && result.exitCode !== 1) {
      const commandDescription = `git diff --no-index --numstat -z --patch -- /dev/null ${filePath}`;
      return yield* Effect.fail(
        gitOperationError(
          `${commandDescription} failed (exit ${result.exitCode ?? "unknown"}): ${combineOutput(result.stdout, result.stderr)}`,
          commandDescription,
        ),
      );
    }
    const output = result.stdout;
    // -z keeps paths verbatim. A two-path numstat record starts with an empty path.
    const header = /^(\d+|-)\t(\d+|-)\t([^\0]*)\0/.exec(output);
    let offset = header?.[0].length ?? 0;
    let file = header?.[3];
    if (file === "") {
      const oldPathEnd = output.indexOf("\0", offset);
      const newPathEnd = output.indexOf("\0", oldPathEnd + 1);
      if (output.slice(offset, oldPathEnd) === "/dev/null" && newPathEnd >= 0) {
        file = output.slice(oldPathEnd + 1, newPathEnd);
        offset = newPathEnd + 1;
      }
    }
    const patch = output.slice(offset + 1);
    if (
      !header ||
      file !== filePath ||
      output[offset] !== "\0" ||
      !patch.startsWith("diff --git ")
    ) {
      return yield* Effect.fail(
        gitResourceError(
          `git diff --no-index produced no matching diff entry for ${filePath}: ${combineOutput(output, result.stderr)}`,
          "git.diff.no-index",
          filePath,
        ),
      );
    }
    return {
      file: filePath,
      type: "added",
      additions: header[1] === "-" ? 0 : Number(header[1]),
      deletions: header[2] === "-" ? 0 : Number(header[2]),
      // Keep the line endings and final blank line of the existing FileDiff contract.
      diff: `${patch.replace(/\r?\n/g, "\n")}\n`,
    };
  });
const expandUntrackedStatusPaths = (
  runner: GitCommandRunner,
  workingDirectory: string,
  statusPath: string,
) =>
  Effect.gen(function* () {
    if (!statusPath) {
      return [];
    }
    const pathStats = yield* Effect.tryPromise({
      try: () => stat(path.join(workingDirectory, statusPath)),
      catch: (cause) =>
        toHostOperationError(cause, "git.expandUntrackedStatusPaths.stat", {
          statusPath,
          workingDirectory,
        }),
    }).pipe(Effect.catch(() => Effect.succeed(undefined)));
    if (!pathStats?.isDirectory()) {
      return [statusPath];
    }
    const result = yield* runGitAllowFailure(runner, workingDirectory, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      statusPath,
    ]);
    if (!result.ok) {
      return yield* Effect.fail(
        gitOperationError(
          `git ls-files --others --exclude-standard -- ${statusPath} failed: ${combineOutput(result.stdout, result.stderr)}`,
          "git.ls-files",
        ),
      );
    }
    const filePaths = result.stdout.split("\0").filter(Boolean);
    if (filePaths.length === 0) {
      return yield* Effect.fail(
        gitResourceError(
          `git ls-files --others --exclude-standard -- ${statusPath} returned no files`,
          "git.ls-files",
          statusPath,
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
  /** Full object IDs let a content hash detect binary and untracked changes. */
  options: { fullIndex?: boolean } = {},
): Effect.Effect<GitFileDiff[], GitDiffError> =>
  Effect.gen(function* () {
    const stats = parseNumstat(numstatOutput);
    const fileDiffs = splitDiffByFile(diffOutput);
    const results: GitFileDiff[] = fileDiffs.map(({ file, diff }) => {
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
    const untrackedPaths = new Set<string>();
    const statusPaths = new Set(
      fileStatuses.filter((status) => status.status === "untracked").map((status) => status.path),
    );
    for (const statusPath of statusPaths) {
      for (const filePath of yield* expandUntrackedStatusPaths(
        runner,
        workingDirectory,
        statusPath,
      )) {
        if (filesWithDiffs.has(filePath)) {
          continue;
        }
        untrackedPaths.add(filePath);
      }
    }
    const untrackedDiffs = yield* Effect.forEach(
      untrackedPaths,
      (filePath) =>
        loadNoIndexDiffPayload(runner, workingDirectory, filePath, options.fullIndex === true),
      { concurrency: 4 },
    );
    results.push(...untrackedDiffs);
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
      "-z",
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
): Effect.Effect<string, HostOperationErrorAggregate | HostValidationErrorAggregate> =>
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
export const resolveBranchDiffBase = (
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
