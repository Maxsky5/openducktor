import { execFile, spawn } from "node:child_process";
import { readFile, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  CommitsAheadBehind,
  FileDiff,
  FileStatus,
  GitBranch,
  GitCommitAllResult,
  GitConflict,
  GitConflictAbortResult,
  GitConflictOperation,
  GitCurrentBranch,
  GitDiffScope,
  GitFetchRemoteResult,
  GitFileStatusCounts,
  GitPullBranchResult,
  GitPushBranchResult,
  GitRebaseAbortResult,
  GitRebaseBranchResult,
  GitResetWorktreeSelection,
  GitResetWorktreeSelectionResult,
  GitUpstreamAheadBehind,
} from "@openducktor/contracts";
import type {
  GitBranchUpstreamSetup,
  GitMergeBranchRequest,
  GitPort,
  GitPushBranchOptions,
  GitRemote,
  GitWorktreeStatusData,
  GitWorktreeStatusSummaryData,
} from "../ports/git-port";

const execFileAsync = promisify(execFile);

export type GitCommandResult = {
  stdout: string;
  stderr: string;
};

export type GitCommandRunner = (
  workingDirectory: string,
  args: string[],
  options?: { allowFailure?: boolean; stdin?: string },
) => Promise<GitCommandResult & { ok: boolean }>;

const createGitEnvironment = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
  ...env,
  GIT_TERMINAL_PROMPT: "0",
});

const runSpawnedGit = (
  workingDirectory: string,
  args: string[],
  options: { allowFailure?: boolean; stdin: string },
  env: NodeJS.ProcessEnv,
): Promise<GitCommandResult & { ok: boolean }> =>
  new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: workingDirectory,
      env: createGitEnvironment(env),
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, stdout, stderr });
        return;
      }
      if (options.allowFailure) {
        resolve({ ok: false, stdout, stderr });
        return;
      }

      reject(new Error(combineOutput(stdout, stderr)));
    });
    child.stdin.end(options.stdin);
  });

const createDefaultGitRunner =
  (env: NodeJS.ProcessEnv): GitCommandRunner =>
  async (workingDirectory, args, options) => {
    if (options?.stdin !== undefined) {
      return runSpawnedGit(
        workingDirectory,
        args,
        {
          allowFailure: options.allowFailure === true,
          stdin: options.stdin,
        },
        env,
      );
    }

    try {
      const output = await execFileAsync("git", args, {
        cwd: workingDirectory,
        env: createGitEnvironment(env),
        maxBuffer: 16 * 1024 * 1024,
      });
      return { ok: true, stdout: output.stdout, stderr: output.stderr };
    } catch (error) {
      if (options?.allowFailure) {
        const failed = error as { stdout?: string; stderr?: string };
        return {
          ok: false,
          stdout: failed.stdout ?? "",
          stderr: failed.stderr ?? String(error),
        };
      }

      throw error;
    }
  };

const upstreamTargetBranch = "@{upstream}";
const emptyTreeSha1 = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const emptyTreeSha256 = "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321";
const rebaseConflictOutputUnavailable =
  "Git conflict is still in progress in this worktree. Previous command output is unavailable after reload.";
const rebaseConflictTargetUnavailable = "current rebase target";

const runGit = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  args: string[],
): Promise<string> => {
  const result = await runner(workingDirectory, args);
  return result.stdout;
};

const runGitAllowFailure = (
  runner: GitCommandRunner,
  workingDirectory: string,
  args: string[],
): Promise<GitCommandResult & { ok: boolean }> =>
  runner(workingDirectory, args, { allowFailure: true });

const runGitWithStdinAllowFailure = (
  runner: GitCommandRunner,
  workingDirectory: string,
  args: string[],
  stdin: string,
): Promise<GitCommandResult & { ok: boolean }> =>
  runner(workingDirectory, args, { allowFailure: true, stdin });

const referenceExists = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  reference: string,
): Promise<boolean> => {
  const targetRef = requireNonEmpty(reference, "reference");
  const result = await runGitAllowFailure(runner, workingDirectory, [
    "rev-parse",
    "--verify",
    "--quiet",
    targetRef,
  ]);
  return result.ok;
};

const resolveGitCommonDirectory = async (
  runner: GitCommandRunner,
  workingDirectory: string,
): Promise<string> => {
  const output = await runGit(runner, workingDirectory, ["rev-parse", "--git-common-dir"]);
  const commonDir = output.trim();
  if (!commonDir) {
    throw new Error(`Git common directory is empty for ${workingDirectory}`);
  }

  const absoluteCommonDir = path.isAbsolute(commonDir)
    ? commonDir
    : path.join(workingDirectory, commonDir);
  return realpath(absoluteCommonDir);
};

const parseBranchRows = (output: string): GitBranch[] => {
  const branches = output.split(/\r?\n/).flatMap((line): GitBranch[] => {
    const trimmed = line.trim();
    if (!trimmed) {
      return [];
    }

    const [headMarker, name, fullRef] = trimmed.split("|", 3);
    if (!headMarker || !name || !fullRef) {
      return [];
    }

    const isRemote = fullRef.startsWith("refs/remotes/");
    if (isRemote && fullRef.endsWith("/HEAD")) {
      return [];
    }

    return [
      {
        name,
        isCurrent: headMarker === "1" || headMarker === "*",
        isRemote,
      },
    ];
  });

  branches.sort((left, right) => {
    if (left.isCurrent !== right.isCurrent) {
      return left.isCurrent ? -1 : 1;
    }
    if (left.isRemote !== right.isRemote) {
      return left.isRemote ? 1 : -1;
    }
    return left.name.localeCompare(right.name);
  });

  return branches;
};

const parseRemoteNames = (output: string): string[] =>
  output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const parseAheadBehind = (output: string): CommitsAheadBehind => {
  const [behindRaw, aheadRaw] = output.trim().split(/\s+/, 2);
  const behind = Number.parseInt(behindRaw ?? "", 10);
  const ahead = Number.parseInt(aheadRaw ?? "", 10);

  if (!Number.isFinite(behind) || !Number.isFinite(ahead)) {
    throw new Error(`Unable to parse git ahead/behind counts: ${output.trim()}`);
  }

  return { ahead, behind };
};

const requireNonEmpty = (value: string, label: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`git ${label} cannot be empty`);
  }

  return trimmed;
};

const combineOutput = (stdout: string, stderr: string): string => {
  const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
  return output.length > 0 ? output : "no output";
};

const combineOptionalOutput = (stdout: string, stderr: string): string =>
  [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");

const porcelainCharToStatus = (value: string): string => {
  switch (value) {
    case "M":
      return "modified";
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "U":
      return "unmerged";
    case "T":
      return "typechange";
    default:
      return "unknown";
  }
};

const parseStatusPorcelain = (output: string): FileStatus[] =>
  output.split(/\r?\n/).flatMap((line): FileStatus[] => {
    if (line.length < 4) {
      return [];
    }

    const index = line.at(0) ?? "";
    const worktree = line.at(1) ?? "";
    const filePath = line.slice(3);

    if (index === "?" && worktree === "?") {
      return [{ path: filePath, status: "untracked", staged: false }];
    }
    if (index === "!" && worktree === "!") {
      return [{ path: filePath, status: "ignored", staged: false }];
    }
    if (index !== " " && worktree === " ") {
      return [{ path: filePath, status: porcelainCharToStatus(index), staged: true }];
    }
    if (index === " " && worktree !== " ") {
      return [{ path: filePath, status: porcelainCharToStatus(worktree), staged: false }];
    }

    return [{ path: filePath, status: porcelainCharToStatus(index), staged: true }];
  });

const fileStatusCounts = (fileStatuses: FileStatus[]): GitFileStatusCounts => {
  const total = fileStatuses.length;
  const staged = fileStatuses.filter((status) => status.staged).length;
  return { total, staged, unstaged: total - staged };
};

const getCurrentBranchUnchecked = async (
  runner: GitCommandRunner,
  workingDirectory: string,
): Promise<GitCurrentBranch> => {
  const output = await runGit(runner, workingDirectory, ["branch", "--show-current"]);
  const name = output
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0)
    ?.trim();
  const revisionResult = await runGitAllowFailure(runner, workingDirectory, ["rev-parse", "HEAD"]);
  const revision = revisionResult.ok
    ? revisionResult.stdout
        .split(/\r?\n/)
        .find((line) => line.trim().length > 0)
        ?.trim()
    : undefined;

  return {
    detached: name === undefined,
    name,
    revision,
  };
};

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

const parseNumstat = (output: string): Map<string, { additions: number; deletions: number }> => {
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

const parseDiffGitHeaderToken = (
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

const parseDiffGitNewPath = (line: string): string | undefined => {
  const rest = line.slice("diff --git ".length);
  const oldPath = parseDiffGitHeaderToken(rest);
  if (!oldPath) {
    return undefined;
  }

  const newPath = parseDiffGitHeaderToken(oldPath.remaining);
  return newPath?.token.startsWith("b/") ? newPath.token.slice(2) : undefined;
};

const splitDiffByFile = (fullDiff: string): Array<{ file: string; diff: string }> => {
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

type HunkSpec = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
};

type ParsedHunk = {
  text: string;
  spec: HunkSpec;
};

type RenamePaths = {
  oldPath: string;
  newPath: string;
};

type ParsedPatch = {
  header: string;
  hunks: ParsedHunk[];
  renamePaths?: RenamePaths;
};

const parseHunkRange = (input: string): { start: number; count: number } => {
  const trimmed = input.trim();
  const [startRaw, countRaw = "1"] = trimmed.split(",", 2);
  const start = Number.parseInt(startRaw ?? "", 10);
  const count = Number.parseInt(countRaw, 10);
  if (!Number.isFinite(start)) {
    throw new Error(`Invalid hunk range start: ${trimmed}`);
  }
  if (!Number.isFinite(count)) {
    throw new Error(`Invalid hunk range count: ${trimmed}`);
  }

  return { start, count };
};

const parseHunkSpec = (line: string): HunkSpec => {
  const rest = line.startsWith("@@ -") ? line.slice("@@ -".length) : undefined;
  if (rest === undefined) {
    throw new Error(`Invalid hunk header: ${line}`);
  }

  const splitIndex = rest.indexOf(" +");
  if (splitIndex < 0) {
    throw new Error(`Invalid hunk header: ${line}`);
  }
  const oldPart = rest.slice(0, splitIndex);
  const remaining = rest.slice(splitIndex + " +".length);
  const newEndIndex = remaining.indexOf(" @@");
  if (newEndIndex < 0) {
    throw new Error(`Invalid hunk header: ${line}`);
  }

  const oldRange = parseHunkRange(oldPart);
  const newRange = parseHunkRange(remaining.slice(0, newEndIndex));
  return {
    oldStart: oldRange.start,
    oldCount: oldRange.count,
    newStart: newRange.start,
    newCount: newRange.count,
  };
};

const parseRenamePaths = (header: string): RenamePaths | undefined => {
  let oldPath: string | undefined;
  let newPath: string | undefined;

  for (const line of header.split(/\r?\n/)) {
    if (line.startsWith("rename from ")) {
      oldPath = line.slice("rename from ".length).trim();
    } else if (line.startsWith("rename to ")) {
      newPath = line.slice("rename to ".length).trim();
    }
  }

  return oldPath && newPath ? { oldPath, newPath } : undefined;
};

const parseRenamePathsFromDiffHeader = (header: string): RenamePaths | undefined => {
  const diffLine = header.split(/\r?\n/).find((line) => line.startsWith("diff --git "));
  if (!diffLine) {
    return undefined;
  }

  const oldPath = parseDiffGitHeaderToken(diffLine.slice("diff --git ".length));
  const newPath = oldPath ? parseDiffGitHeaderToken(oldPath.remaining) : undefined;
  const normalizedOldPath = oldPath?.token.startsWith("a/") ? oldPath.token.slice(2) : undefined;
  const normalizedNewPath = newPath?.token.startsWith("b/") ? newPath.token.slice(2) : undefined;

  if (!normalizedOldPath || !normalizedNewPath || normalizedOldPath === normalizedNewPath) {
    return undefined;
  }

  return { oldPath: normalizedOldPath, newPath: normalizedNewPath };
};

const parsePatchHunks = (patch: string): ParsedPatch => {
  let header = "";
  const hunks: ParsedHunk[] = [];
  let currentHunk = "";
  let currentSpec: HunkSpec | undefined;
  let inHunk = false;

  for (const line of patch.match(/[^\n]*\n|[^\n]+/g) ?? []) {
    if (line.startsWith("@@ ")) {
      if (inHunk && currentHunk.length > 0) {
        if (!currentSpec) {
          throw new Error("Patch hunk is missing parsed hunk metadata");
        }
        hunks.push({ text: currentHunk, spec: currentSpec });
        currentHunk = "";
      }

      currentSpec = parseHunkSpec(line);
      inHunk = true;
    }

    if (inHunk) {
      currentHunk += line;
    } else {
      header += line;
    }
  }

  if (inHunk && currentHunk.length > 0) {
    if (!currentSpec) {
      throw new Error("Patch hunk is missing parsed hunk metadata");
    }
    hunks.push({ text: currentHunk, spec: currentSpec });
  }

  const renamePaths = parseRenamePaths(header) ?? parseRenamePathsFromDiffHeader(header);
  return {
    header,
    hunks,
    ...(renamePaths ? { renamePaths } : {}),
  };
};

const combinePatchHunk = (header: string, hunk: ParsedHunk): string => `${header}${hunk.text}`;

const rangesOverlap = (
  leftStart: number,
  leftCount: number,
  rightStart: number,
  rightCount: number,
): boolean => {
  const leftEnd = leftStart + Math.max(leftCount, 1) - 1;
  const rightEnd = rightStart + Math.max(rightCount, 1) - 1;
  return !(leftEnd < rightStart || rightEnd < leftStart);
};

const hunkSpecsOverlap = (left: HunkSpec, right: HunkSpec): boolean =>
  rangesOverlap(left.oldStart, left.oldCount, right.oldStart, right.oldCount) ||
  rangesOverlap(left.newStart, left.newCount, right.newStart, right.newCount);

const hunkBody = (text: string): string => {
  const index = text.indexOf("\n");
  return index >= 0 ? text.slice(index + 1) : text;
};

const hunkSpecsEqual = (left: HunkSpec, right: HunkSpec): boolean =>
  left.oldStart === right.oldStart &&
  left.oldCount === right.oldCount &&
  left.newStart === right.newStart &&
  left.newCount === right.newCount;

const findMatchingCachedHunk = (
  cachedPatch: ParsedPatch,
  selectedHunk: ParsedHunk,
): ParsedHunk | undefined => {
  const exactMatch = cachedPatch.hunks.find(
    (candidate) =>
      hunkSpecsEqual(candidate.spec, selectedHunk.spec) &&
      hunkBody(candidate.text) === hunkBody(selectedHunk.text),
  );
  if (exactMatch) {
    return exactMatch;
  }

  if (cachedPatch.hunks.some((candidate) => hunkSpecsOverlap(candidate.spec, selectedHunk.spec))) {
    throw new Error(
      "Cannot reset a hunk that mixes staged and unstaged changes. Unstage it or reset the whole file instead.",
    );
  }

  return undefined;
};

const ensureNoIndexDiffOutput = (
  result: GitCommandResult & { ok: boolean },
  commandDescription: string,
): string => {
  if (result.ok || result.stdout.trim().length > 0) {
    return result.stdout;
  }

  throw new Error(`${commandDescription} failed: ${combineOutput(result.stdout, result.stderr)}`);
};

const loadNoIndexDiffPayload = async (
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

const pathExists = async (inputPath: string): Promise<boolean> => {
  try {
    await stat(inputPath);
    return true;
  } catch {
    return false;
  }
};

const expandUntrackedStatusPaths = async (
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

const buildFileDiffs = async (
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

const loadDiffPayload = async (
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

const emptyTreeOid = async (
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

const resolveBranchDiffBase = async (
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

const loadBranchChangesDiffPayload = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch: string,
): Promise<{ numstat: string; diff: string }> => {
  const diffBase = await resolveBranchDiffBase(runner, workingDirectory, targetBranch);
  return loadDiffPayload(runner, workingDirectory, diffBase);
};

const normalizeMergeRef = (mergeRef: string): string =>
  mergeRef.startsWith("refs/") ? mergeRef : `refs/heads/${mergeRef}`;

type UpstreamTargetConfig = {
  remote: string;
  mergeRef: string;
  upstreamRef: string;
};

const resolveUpstreamRef = (remote: string, mergeRef: string): string => {
  const normalizedMerge = normalizeMergeRef(mergeRef);
  if (remote === ".") {
    return normalizedMerge;
  }

  const branchRef = normalizedMerge.startsWith("refs/heads/")
    ? normalizedMerge.slice("refs/heads/".length)
    : normalizedMerge;
  return `refs/remotes/${remote}/${branchRef}`;
};

const matchesRemoteBranchName = (remoteRef: string, branch: string): boolean => {
  const remainder = remoteRef.startsWith("refs/remotes/")
    ? remoteRef.slice("refs/remotes/".length)
    : undefined;
  if (!remainder) {
    return false;
  }

  const slash = remainder.indexOf("/");
  if (slash < 0) {
    return false;
  }

  return remainder.slice(slash + 1) === branch;
};

const resolveFallbackRemoteRefForBranch = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  branch: string,
): Promise<string | undefined> => {
  const result = await runGitAllowFailure(runner, workingDirectory, [
    "for-each-ref",
    "--format=%(refname)",
    "refs/remotes",
  ]);
  if (!result.ok) {
    throw new Error(
      `Failed to list remote refs while resolving upstream for branch ${branch}: ${combineOutput(
        result.stdout,
        result.stderr,
      )}`,
    );
  }

  const matches = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => matchesRemoteBranchName(line, branch));
  if (matches.length === 0) {
    return undefined;
  }

  const preferredOriginRef = `refs/remotes/origin/${branch}`;
  if (matches.includes(preferredOriginRef)) {
    return preferredOriginRef;
  }

  return matches.length === 1 ? matches[0] : undefined;
};

const resolveUpstreamTargetForBranch = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  branchName: string | undefined,
): Promise<string | undefined> => {
  if (!branchName) {
    return undefined;
  }

  const remoteResult = await runGitAllowFailure(runner, workingDirectory, [
    "config",
    "--get",
    `branch.${branchName}.remote`,
  ]);
  if (!remoteResult.ok || !remoteResult.stdout.trim()) {
    return resolveFallbackRemoteRefForBranch(runner, workingDirectory, branchName);
  }

  const mergeResult = await runGitAllowFailure(runner, workingDirectory, [
    "config",
    "--get",
    `branch.${branchName}.merge`,
  ]);
  if (!mergeResult.ok || !mergeResult.stdout.trim()) {
    return resolveFallbackRemoteRefForBranch(runner, workingDirectory, branchName);
  }

  const upstreamRef = resolveUpstreamRef(remoteResult.stdout.trim(), mergeResult.stdout.trim());
  const existsResult = await runGitAllowFailure(runner, workingDirectory, [
    "show-ref",
    "--verify",
    "--quiet",
    upstreamRef,
  ]);
  if (!existsResult.ok) {
    return resolveFallbackRemoteRefForBranch(runner, workingDirectory, branchName);
  }

  return upstreamRef;
};

const resolveUpstreamTargetConfigForBranch = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  branchName: string | undefined,
): Promise<UpstreamTargetConfig | undefined> => {
  if (!branchName) {
    return undefined;
  }

  const remoteResult = await runGitAllowFailure(runner, workingDirectory, [
    "config",
    "--get",
    `branch.${branchName}.remote`,
  ]);
  if (!remoteResult.ok || !remoteResult.stdout.trim()) {
    return undefined;
  }

  const mergeResult = await runGitAllowFailure(runner, workingDirectory, [
    "config",
    "--get",
    `branch.${branchName}.merge`,
  ]);
  if (!mergeResult.ok || !mergeResult.stdout.trim()) {
    return undefined;
  }

  const remote = remoteResult.stdout.trim();
  const mergeRef = normalizeMergeRef(mergeResult.stdout.trim());
  return {
    remote,
    mergeRef,
    upstreamRef: resolveUpstreamRef(remote, mergeRef),
  };
};

const resolveEffectiveTargetBranch = (
  requestedTargetBranch: string,
  upstreamTarget: string | undefined,
): string | undefined => {
  if (requestedTargetBranch === upstreamTargetBranch) {
    return upstreamTarget;
  }

  return requestedTargetBranch;
};

const commitsAgainstTargetOrDefault = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch: string | undefined,
): Promise<CommitsAheadBehind> => {
  if (!targetBranch) {
    return { ahead: 0, behind: 0 };
  }

  const range = `${targetBranch}...HEAD`;
  const output = await runGit(runner, workingDirectory, [
    "rev-list",
    "--count",
    "--left-right",
    "--end-of-options",
    range,
  ]);
  return parseAheadBehind(output);
};

const resolveUpstreamAheadBehind = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  upstreamTarget: string | undefined,
  targetAheadBehind: CommitsAheadBehind,
): Promise<GitUpstreamAheadBehind> => {
  if (!upstreamTarget) {
    return { outcome: "untracked", ahead: targetAheadBehind.ahead };
  }

  try {
    const counts = await commitsAgainstTargetOrDefault(runner, workingDirectory, upstreamTarget);
    return { outcome: "tracking", ahead: counts.ahead, behind: counts.behind };
  } catch (error) {
    return { outcome: "error", message: error instanceof Error ? error.message : String(error) };
  }
};

const resolveGitPath = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  suffix: string,
): Promise<string> => {
  const output = await runGit(runner, workingDirectory, [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    suffix,
  ]);
  const gitPath = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!gitPath) {
    throw new Error(`git rev-parse --git-path ${suffix} returned no path`);
  }

  return gitPath;
};

const readGitPathContentsIfExists = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  suffix: string,
): Promise<string | undefined> => {
  const gitPath = await resolveGitPath(runner, workingDirectory, suffix);
  if (!(await pathExists(gitPath))) {
    return undefined;
  }

  const contents = await readFile(gitPath, "utf8");
  const trimmed = contents.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const hasGitPath = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  suffix: string,
): Promise<boolean> => pathExists(await resolveGitPath(runner, workingDirectory, suffix));

const normalizeHeadName = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.startsWith("refs/heads/") ? trimmed.slice("refs/heads/".length) : trimmed;
};

const loadRebaseConflictContext = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  currentBranch: GitCurrentBranch,
  fallbackTargetBranch: string | undefined,
  fileStatuses: FileStatus[],
): Promise<GitConflict | undefined> => {
  const conflictedFiles = fileStatuses
    .filter((statusEntry) => statusEntry.status === "unmerged")
    .map((statusEntry) => statusEntry.path);
  if (conflictedFiles.length === 0) {
    return undefined;
  }

  const isRebaseInProgress =
    (await hasGitPath(runner, workingDirectory, "rebase-merge")) ||
    (await hasGitPath(runner, workingDirectory, "rebase-apply"));
  if (!isRebaseInProgress) {
    return undefined;
  }

  const mergeHeadName = await readGitPathContentsIfExists(
    runner,
    workingDirectory,
    "rebase-merge/head-name",
  );
  const applyHeadName = await readGitPathContentsIfExists(
    runner,
    workingDirectory,
    "rebase-apply/head-name",
  );
  const currentBranchName =
    currentBranch.name ?? normalizeHeadName(mergeHeadName) ?? normalizeHeadName(applyHeadName);
  const statusOutput = await runGitAllowFailure(runner, workingDirectory, [
    "status",
    "--untracked-files=no",
  ])
    .then((result) => combineOutput(result.stdout, result.stderr))
    .catch(() => rebaseConflictOutputUnavailable);

  return {
    operation: "rebase",
    currentBranch: currentBranchName,
    targetBranch: fallbackTargetBranch ?? rebaseConflictTargetUnavailable,
    conflictedFiles,
    output: statusOutput.trim() ? statusOutput : rebaseConflictOutputUnavailable,
  };
};

const getStatusUnchecked = async (
  runner: GitCommandRunner,
  workingDirectory: string,
): Promise<FileStatus[]> => {
  const output = await runGit(runner, workingDirectory, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  return parseStatusPorcelain(output);
};

const findFileDiff = (fileDiffs: FileDiff[], filePath: string): FileDiff => {
  const fileDiff = fileDiffs.find((diff) => diff.file === filePath);
  if (!fileDiff) {
    throw new Error("Displayed diff is stale. Refresh and try again.");
  }

  return fileDiff;
};

const isTrackedPath = async (
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

const runGitApplyReverse = async (
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

const loadCachedPatch = async (
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

const loadUnstagedPatch = async (
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

const resetRenamedFileSelection = async (
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

const resetFileSelection = async (
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

const resetHunkSelection = async (
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

const resetWorktreeSelection = (
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

const createWorktree = async (
  runner: GitCommandRunner,
  repoPath: string,
  worktreePath: string,
  branch: string,
  createBranch: boolean,
  startPoint?: string,
): Promise<void> => {
  const targetBranch = requireNonEmpty(branch, "branch");
  const targetWorktreePath = requireNonEmpty(worktreePath, "worktree path");
  const args = createBranch
    ? [
        "worktree",
        "add",
        "-b",
        targetBranch,
        "--end-of-options",
        targetWorktreePath,
        ...(startPoint ? [requireNonEmpty(startPoint, "start point")] : []),
      ]
    : ["worktree", "add", "--end-of-options", targetWorktreePath, targetBranch];

  await runGit(runner, repoPath, args);
};

const deleteReference = async (
  runner: GitCommandRunner,
  repoPath: string,
  reference: string,
): Promise<void> => {
  await runGit(runner, repoPath, ["update-ref", "-d", requireNonEmpty(reference, "reference")]);
};

const collectFailedBranchConfigCleanup = async (
  runner: GitCommandRunner,
  repoPath: string,
  keys: string[],
  cleanupErrors: string[],
): Promise<void> => {
  for (const key of keys) {
    const result = await runGitAllowFailure(runner, repoPath, ["config", "--unset-all", key]);
    if (!result.ok) {
      cleanupErrors.push(
        `Also failed to unset git config ${key}: ${combineOutput(result.stdout, result.stderr)}`,
      );
    }
  }
};

const formatCleanupErrors = (cleanupErrors: string[]): string =>
  cleanupErrors.length === 0 ? "" : `\n${cleanupErrors.join("\n")}`;

const cleanupFailedUpstreamSetup = async (
  runner: GitCommandRunner,
  repoPath: string,
  branchRemoteKey: string,
  branchMergeKey: string | null,
  createdTrackingRef: string | null,
): Promise<string> => {
  const cleanupErrors: string[] = [];
  if (createdTrackingRef) {
    const result = await runGitAllowFailure(runner, repoPath, [
      "update-ref",
      "-d",
      createdTrackingRef,
    ]);
    if (!result.ok) {
      cleanupErrors.push(
        `Also failed to delete created upstream tracking ref ${createdTrackingRef}: ${combineOutput(result.stdout, result.stderr)}`,
      );
    }
  }
  await collectFailedBranchConfigCleanup(
    runner,
    repoPath,
    [branchRemoteKey, ...(branchMergeKey ? [branchMergeKey] : [])],
    cleanupErrors,
  );
  return formatCleanupErrors(cleanupErrors);
};

const configureBranchUpstream = async (
  runner: GitCommandRunner,
  repoPath: string,
  worktreePath: string,
  branch: string,
  upstreamRemote: string,
): Promise<GitBranchUpstreamSetup> => {
  const targetBranch = requireNonEmpty(branch, "branch");
  const remote = requireNonEmpty(upstreamRemote, "upstream remote");
  const branchRemoteKey = `branch.${targetBranch}.remote`;
  const branchMergeKey = `branch.${targetBranch}.merge`;
  const localBranchRef = `refs/heads/${targetBranch}`;
  const trackingRef = `refs/remotes/${remote}/${targetBranch}`;
  const expectedUpstream = `${remote}/${targetBranch}`;

  await runGit(runner, repoPath, ["config", branchRemoteKey, remote]);
  try {
    await runGit(runner, repoPath, ["config", branchMergeKey, localBranchRef]);
  } catch (error) {
    const cleanupError = await cleanupFailedUpstreamSetup(
      runner,
      repoPath,
      branchRemoteKey,
      null,
      null,
    );
    throw new Error(
      `Failed configuring upstream merge for build worktree branch ${targetBranch}: ${String(error)}${cleanupError}`,
      { cause: error },
    );
  }

  const trackingRefAlreadyExists = await referenceExists(runner, repoPath, trackingRef);
  let createdTrackingRef: string | null = null;
  if (!trackingRefAlreadyExists) {
    try {
      const localBranchOid = (await runGit(runner, repoPath, ["rev-parse", localBranchRef])).trim();
      if (!localBranchOid) {
        throw new Error(`git rev-parse returned an empty revision for ${localBranchRef}`);
      }
      await runGit(runner, repoPath, ["update-ref", trackingRef, localBranchOid]);
      createdTrackingRef = trackingRef;
    } catch (error) {
      const cleanupError = await cleanupFailedUpstreamSetup(
        runner,
        repoPath,
        branchRemoteKey,
        branchMergeKey,
        null,
      );
      throw new Error(
        `Failed creating upstream tracking ref ${trackingRef} for build worktree branch ${targetBranch}: ${String(error)}${cleanupError}`,
        { cause: error },
      );
    }
  }

  try {
    const resolvedUpstream = (
      await runGit(runner, worktreePath, [
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{upstream}",
      ])
    ).trim();
    if (resolvedUpstream !== expectedUpstream) {
      const cleanupError = await cleanupFailedUpstreamSetup(
        runner,
        repoPath,
        branchRemoteKey,
        branchMergeKey,
        createdTrackingRef,
      );
      throw new Error(
        `configured upstream resolved to ${resolvedUpstream}, expected ${expectedUpstream}${cleanupError}`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("configured upstream resolved to ")) {
      throw error;
    }
    const cleanupError = await cleanupFailedUpstreamSetup(
      runner,
      repoPath,
      branchRemoteKey,
      branchMergeKey,
      createdTrackingRef,
    );
    throw new Error(
      `Failed verifying upstream tracking for build worktree branch ${targetBranch}: ${String(error)}${cleanupError}`,
      { cause: error },
    );
  }

  return { createdTrackingRef };
};

const removeWorktree = async (
  runner: GitCommandRunner,
  repoPath: string,
  worktreePath: string,
  force: boolean,
): Promise<void> => {
  const targetWorktreePath = requireNonEmpty(worktreePath, "worktree path");
  const args = ["worktree", "remove"];
  if (force) {
    args.push("--force");
  }
  args.push("--end-of-options", targetWorktreePath);

  await runGit(runner, repoPath, args);
};

const deleteLocalBranch = async (
  runner: GitCommandRunner,
  repoPath: string,
  branch: string,
  force: boolean,
): Promise<void> => {
  const targetBranch = requireNonEmpty(branch, "branch");
  await runGit(runner, repoPath, ["branch", force ? "-D" : "-d", "--end-of-options", targetBranch]);
};

const isAncestor = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  ancestor: string,
  descendant: string,
): Promise<boolean> => {
  const ancestorRef = requireNonEmpty(ancestor, "ancestor ref");
  const descendantRef = requireNonEmpty(descendant, "descendant ref");
  const result = await runGitAllowFailure(runner, workingDirectory, [
    "merge-base",
    "--is-ancestor",
    "--end-of-options",
    ancestorRef,
    descendantRef,
  ]);
  if (result.ok) {
    return true;
  }
  if (!result.stdout.trim() && !result.stderr.trim()) {
    return false;
  }

  throw new Error(
    `git merge-base --is-ancestor ${ancestorRef} ${descendantRef} failed: ${combineOutput(
      result.stdout,
      result.stderr,
    )}`,
  );
};

const suggestedSquashCommitMessage = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  sourceBranch: string,
  targetBranch: string,
): Promise<string | undefined> => {
  const sourceRef = requireNonEmpty(sourceBranch, "source branch");
  const targetRef = requireNonEmpty(targetBranch, "target branch");
  const revListResult = await runGitAllowFailure(runner, workingDirectory, [
    "rev-list",
    "--reverse",
    "--end-of-options",
    `${targetRef}..${sourceRef}`,
  ]);
  if (!revListResult.ok) {
    throw new Error(
      `git rev-list ${targetRef}..${sourceRef} failed: ${combineOutput(
        revListResult.stdout,
        revListResult.stderr,
      )}`,
    );
  }

  const oldestCommit = revListResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!oldestCommit) {
    return undefined;
  }

  const message = (
    await runGit(runner, workingDirectory, ["show", "-s", "--format=%B", oldestCommit])
  ).trim();
  return message.length > 0 ? message : undefined;
};

const checkoutBranchFromTargetRef = (targetRef: string): string => {
  const slash = targetRef.indexOf("/");
  return slash >= 0 ? targetRef.slice(slash + 1) : targetRef;
};

const finishMergeBranchResult = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  beforeHead: string,
  output: string,
) => {
  const afterHead = await runGit(runner, workingDirectory, ["rev-parse", "HEAD"]);
  if (beforeHead === afterHead) {
    return {
      outcome: "up_to_date" as const,
      output,
    };
  }

  return {
    outcome: "merged" as const,
    output,
  };
};

const mergeConflictOrError = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  commandName: string,
  output: string,
) => {
  const detail = output.length > 0 ? output : `No output from ${commandName}`;
  const conflictedFiles = (await getStatusUnchecked(runner, workingDirectory))
    .filter((statusEntry) => statusEntry.status === "unmerged")
    .map((statusEntry) => statusEntry.path);
  if (conflictedFiles.length > 0) {
    return {
      outcome: "conflicts" as const,
      conflictedFiles,
      output: detail,
    };
  }

  throw new Error(`${commandName} failed: ${detail}`);
};

const mergeBranchWithCommit = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  sourceBranch: string,
  beforeHead: string,
) => {
  const result = await runGitAllowFailure(runner, workingDirectory, [
    "merge",
    "--no-ff",
    "--end-of-options",
    sourceBranch,
  ]);
  const output = combineOptionalOutput(result.stdout, result.stderr);
  if (!result.ok) {
    return mergeConflictOrError(runner, workingDirectory, "git merge --no-ff", output);
  }

  return finishMergeBranchResult(runner, workingDirectory, beforeHead, output);
};

const mergeBranchWithSquash = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  sourceBranch: string,
  beforeHead: string,
  squashCommitMessage: string | undefined,
) => {
  const commitMessage = requireNonEmpty(squashCommitMessage ?? "", "squash commit message");
  const result = await runGitAllowFailure(runner, workingDirectory, [
    "merge",
    "--squash",
    "--end-of-options",
    sourceBranch,
  ]);
  const output = combineOptionalOutput(result.stdout, result.stderr);
  if (!result.ok) {
    return mergeConflictOrError(runner, workingDirectory, "git merge --squash", output);
  }

  const staged = await runGitAllowFailure(runner, workingDirectory, [
    "diff",
    "--cached",
    "--quiet",
  ]);
  if (staged.ok) {
    return {
      outcome: "up_to_date" as const,
      output,
    };
  }

  const commit = await runGitAllowFailure(runner, workingDirectory, [
    "commit",
    "-m",
    commitMessage,
  ]);
  const commitOutput = combineOptionalOutput(commit.stdout, commit.stderr);
  if (!commit.ok) {
    throw new Error(`git commit failed after squash merge: ${commitOutput}`);
  }

  const mergedOutput =
    output.length === 0
      ? commitOutput
      : commitOutput.length === 0
        ? output
        : `${output}\n${commitOutput}`;
  return finishMergeBranchResult(runner, workingDirectory, beforeHead, mergedOutput);
};

const mergeBranchWithRebase = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  sourceWorkingDirectory: string | undefined,
  sourceBranch: string,
  targetBranch: string,
  beforeHead: string,
) => {
  const rebaseWorkingDirectory = sourceWorkingDirectory ?? workingDirectory;
  const rebase = await runGitAllowFailure(runner, rebaseWorkingDirectory, [
    "rebase",
    "--end-of-options",
    targetBranch,
  ]);
  const rebaseOutput = combineOptionalOutput(rebase.stdout, rebase.stderr);
  if (!rebase.ok) {
    return mergeConflictOrError(runner, rebaseWorkingDirectory, "git rebase", rebaseOutput);
  }

  const fastForward = await runGitAllowFailure(runner, workingDirectory, [
    "merge",
    "--ff-only",
    "--end-of-options",
    sourceBranch,
  ]);
  const fastForwardOutput = combineOptionalOutput(fastForward.stdout, fastForward.stderr);
  if (!fastForward.ok) {
    throw new Error(`git merge --ff-only failed after rebase: ${fastForwardOutput}`);
  }

  const output =
    rebaseOutput.length === 0
      ? fastForwardOutput
      : fastForwardOutput.length === 0
        ? rebaseOutput
        : `${rebaseOutput}\n${fastForwardOutput}`;
  return finishMergeBranchResult(runner, workingDirectory, beforeHead, output);
};

const mergeBranch = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  request: GitMergeBranchRequest,
) => {
  const sourceBranch = requireNonEmpty(request.sourceBranch, "source branch");
  const targetBranch = requireNonEmpty(request.targetBranch, "target branch");
  const branches = await parseBranchRows(
    await runGit(runner, workingDirectory, [
      "for-each-ref",
      "--format=%(if)%(HEAD)%(then)1%(else)0%(end)|%(refname:short)|%(refname)",
      "refs/heads",
      "refs/remotes",
    ]),
  );
  const checkoutTargetBranch = branches.some(
    (branch) => branch.isRemote && branch.name === targetBranch,
  )
    ? checkoutBranchFromTargetRef(targetBranch)
    : targetBranch;

  if (sourceBranch === targetBranch) {
    return {
      outcome: "up_to_date" as const,
      output: "Source and target branches are identical",
    };
  }
  if ((await getStatusUnchecked(runner, workingDirectory)).length > 0) {
    throw new Error("Cannot merge with uncommitted changes");
  }

  await switchBranch(runner, workingDirectory, checkoutTargetBranch, false);
  const beforeHead = await runGit(runner, workingDirectory, ["rev-parse", "HEAD"]);
  if (request.method === "merge_commit") {
    return mergeBranchWithCommit(runner, workingDirectory, sourceBranch, beforeHead);
  }
  if (request.method === "squash") {
    return mergeBranchWithSquash(
      runner,
      workingDirectory,
      sourceBranch,
      beforeHead,
      request.squashCommitMessage,
    );
  }

  return mergeBranchWithRebase(
    runner,
    workingDirectory,
    request.sourceWorkingDirectory,
    sourceBranch,
    checkoutTargetBranch,
    beforeHead,
  );
};

const switchBranch = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  branch: string,
  create: boolean,
): Promise<GitCurrentBranch> => {
  const targetBranch = requireNonEmpty(branch, "branch");
  const args = create
    ? ["switch", "-c", targetBranch]
    : ["switch", "--end-of-options", targetBranch];
  await runGit(runner, workingDirectory, args);
  return getCurrentBranchUnchecked(runner, workingDirectory);
};

const remoteNameFromTrackingRef = (targetRef: string): string | undefined => {
  const remainder = targetRef.startsWith("refs/remotes/")
    ? targetRef.slice("refs/remotes/".length)
    : undefined;
  const slash = remainder?.indexOf("/") ?? -1;
  return remainder && slash >= 0 ? remainder.slice(0, slash) : undefined;
};

const isNonFastForwardPushRejection = (output: string): boolean =>
  output
    .split(/\r?\n/)
    .some((line) => line.includes("[rejected]") && line.includes("non-fast-forward")) ||
  (output.includes("rejected") && output.includes("non-fast-forward"));

const resolvePushTrackingSyncRefs = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  remote: string,
  branch: string,
): Promise<{ localBranchRef: string; upstreamRef: string } | undefined> => {
  if (remote === ".") {
    return undefined;
  }

  let localBranchRef: string | undefined;
  if (branch === "HEAD") {
    const currentBranch = await getCurrentBranchUnchecked(runner, workingDirectory);
    if (!currentBranch.name) {
      return undefined;
    }
    localBranchRef = normalizeMergeRef(currentBranch.name);
  } else if (branch.includes(":")) {
    return undefined;
  } else if (branch.startsWith("refs/heads/")) {
    localBranchRef = branch;
  } else if (branch.startsWith("refs/")) {
    return undefined;
  } else {
    localBranchRef = normalizeMergeRef(branch);
  }

  return {
    localBranchRef,
    upstreamRef: resolveUpstreamRef(remote, localBranchRef),
  };
};

const syncPushedRemoteTrackingRef = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  remote: string,
  branch: string,
): Promise<void> => {
  const refs = await resolvePushTrackingSyncRefs(runner, workingDirectory, remote, branch);
  if (!refs) {
    return;
  }

  const localBranchOid = (
    await runGit(runner, workingDirectory, ["rev-parse", refs.localBranchRef])
  ).trim();
  if (!localBranchOid) {
    throw new Error(`git rev-parse returned an empty revision for ${refs.localBranchRef}`);
  }

  await runGit(runner, workingDirectory, ["update-ref", refs.upstreamRef, localBranchOid]);
};

const listRemoteNames = async (
  runner: GitCommandRunner,
  workingDirectory: string,
): Promise<Set<string>> => {
  const result = await runGitAllowFailure(runner, workingDirectory, ["remote"]);
  if (!result.ok) {
    throw new Error(`Failed to list git remotes: ${combineOutput(result.stdout, result.stderr)}`);
  }

  return new Set(parseRemoteNames(result.stdout));
};

const pushUniqueRemote = (remotes: string[], seen: Set<string>, remote: string): void => {
  if (!seen.has(remote)) {
    seen.add(remote);
    remotes.push(remote);
  }
};

const pushFallbackRemoteForBranch = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  branchName: string,
  remotes: string[],
  seen: Set<string>,
): Promise<boolean> => {
  const fallbackRemoteRef = await resolveFallbackRemoteRefForBranch(
    runner,
    workingDirectory,
    branchName,
  );
  if (!fallbackRemoteRef) {
    return false;
  }

  const remote = remoteNameFromTrackingRef(fallbackRemoteRef);
  if (!remote) {
    return false;
  }

  pushUniqueRemote(remotes, seen, remote);
  return true;
};

const resolveCurrentBranchFetchRemote = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  currentBranchName: string | undefined,
  availableRemotes: Set<string>,
  remotes: string[],
  seen: Set<string>,
): Promise<boolean> => {
  const upstreamTarget = await resolveUpstreamTargetConfigForBranch(
    runner,
    workingDirectory,
    currentBranchName,
  );

  if (upstreamTarget) {
    if (upstreamTarget.remote !== ".") {
      if (!availableRemotes.has(upstreamTarget.remote)) {
        throw new Error(
          `Cannot refresh changes because the current branch upstream uses unknown remote \`${upstreamTarget.remote}\``,
        );
      }

      pushUniqueRemote(remotes, seen, upstreamTarget.remote);
      return true;
    }

    return currentBranchName
      ? pushFallbackRemoteForBranch(runner, workingDirectory, currentBranchName, remotes, seen)
      : false;
  }

  return currentBranchName
    ? pushFallbackRemoteForBranch(runner, workingDirectory, currentBranchName, remotes, seen)
    : false;
};

const resolveTargetRemoteName = (
  targetBranch: string,
  availableRemotes: Set<string>,
): string | undefined => {
  if (targetBranch === upstreamTargetBranch) {
    return undefined;
  }

  if (targetBranch.startsWith("refs/remotes/")) {
    const remainder = targetBranch.slice("refs/remotes/".length);
    const slash = remainder.indexOf("/");
    if (slash < 0) {
      return undefined;
    }

    const remote = remainder.slice(0, slash);
    if (availableRemotes.has(remote)) {
      return remote;
    }
    throw new Error(
      `Cannot refresh changes because compare target \`${targetBranch}\` uses unknown remote \`${remote}\``,
    );
  }

  const slash = targetBranch.indexOf("/");
  if (slash < 0) {
    return undefined;
  }

  const remote = targetBranch.slice(0, slash);
  return availableRemotes.has(remote) ? remote : undefined;
};

const resolveRefreshFetchRemotes = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch: string,
): Promise<string[]> => {
  const target = requireNonEmpty(targetBranch, "target branch");
  const currentBranch = await getCurrentBranchUnchecked(runner, workingDirectory);
  const availableRemotes = await listRemoteNames(runner, workingDirectory);
  const remotes: string[] = [];
  const seen = new Set<string>();
  const hasCurrentBranchRemote = await resolveCurrentBranchFetchRemote(
    runner,
    workingDirectory,
    currentBranch.name,
    availableRemotes,
    remotes,
    seen,
  );

  if (target === upstreamTargetBranch && !hasCurrentBranchRemote && availableRemotes.size > 0) {
    throw new Error(
      "Cannot refresh changes because compare target `@{upstream}` requires an upstream remote for the current branch",
    );
  }

  const targetRemote = resolveTargetRemoteName(target, availableRemotes);
  if (targetRemote) {
    pushUniqueRemote(remotes, seen, targetRemote);
  }

  return remotes;
};

const fetchRemote = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch: string,
): Promise<GitFetchRemoteResult> => {
  const remotes = await resolveRefreshFetchRemotes(runner, workingDirectory, targetBranch);
  if (remotes.length === 0) {
    return {
      outcome: "skipped_no_remote",
      output:
        "Skipped git fetch because no applicable remote is configured for this repo or branch.",
    };
  }

  const outputs: string[] = [];
  for (const remote of remotes) {
    const result = await runGitAllowFailure(runner, workingDirectory, [
      "fetch",
      "--prune",
      "--",
      remote,
    ]);
    const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
    if (!result.ok) {
      throw new Error(`git fetch --prune ${remote} failed: ${output}`);
    }
    outputs.push(output.length === 0 ? `Fetched ${remote}` : output);
  }

  return {
    outcome: "fetched",
    output: outputs.join("\n"),
  };
};

const pushBranch = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  branch: string,
  options: GitPushBranchOptions = {},
): Promise<GitPushBranchResult> => {
  const remote = requireNonEmpty(options.remote ?? "origin", "remote");
  const targetBranch = requireNonEmpty(branch, "branch");
  const args = ["push", "--porcelain"];
  if (options.setUpstream) {
    args.push("-u");
  }
  if (options.forceWithLease) {
    args.push("--force-with-lease");
  }
  args.push("--", remote, targetBranch);

  const pushResult = await runGitAllowFailure(runner, workingDirectory, args);
  const output = combineOptionalOutput(pushResult.stdout, pushResult.stderr);
  if (!pushResult.ok) {
    const detail = output.length > 0 ? output : "No output from git push";
    if (isNonFastForwardPushRejection(detail)) {
      return {
        outcome: "rejected_non_fast_forward",
        remote,
        branch: targetBranch,
        output: detail,
      };
    }

    throw new Error(`git push failed for ${remote}/${targetBranch}: ${detail}`);
  }

  let pushedOutput = output;
  try {
    await syncPushedRemoteTrackingRef(runner, workingDirectory, remote, targetBranch);
  } catch (error) {
    const warning = `Push succeeded, but local upstream tracking status may remain stale until the next fetch: ${
      error instanceof Error ? error.message : String(error)
    }`;
    pushedOutput = pushedOutput.trim().length > 0 ? `${pushedOutput}\n${warning}` : warning;
  }

  return {
    outcome: "pushed",
    remote,
    branch: targetBranch,
    output: pushedOutput,
  };
};

const pullBranch = async (
  runner: GitCommandRunner,
  workingDirectory: string,
): Promise<GitPullBranchResult> => {
  const currentBranch = await getCurrentBranchUnchecked(runner, workingDirectory);
  if (currentBranch.detached) {
    throw new Error("Cannot pull while detached");
  }

  const upstreamTarget = await resolveUpstreamTargetConfigForBranch(
    runner,
    workingDirectory,
    currentBranch.name,
  );
  if (!upstreamTarget) {
    throw new Error("Cannot pull because current branch does not track an upstream branch");
  }

  if ((await getStatusUnchecked(runner, workingDirectory)).length > 0) {
    throw new Error("Cannot pull with uncommitted changes");
  }

  if (upstreamTarget.remote !== ".") {
    const fetchRefspec = `+${upstreamTarget.mergeRef}:${upstreamTarget.upstreamRef}`;
    const fetchResult = await runGitAllowFailure(runner, workingDirectory, [
      "fetch",
      "--prune",
      "--",
      upstreamTarget.remote,
      fetchRefspec,
    ]);
    if (!fetchResult.ok) {
      throw new Error(
        `git fetch --prune ${upstreamTarget.remote} failed: ${combineOptionalOutput(
          fetchResult.stdout,
          fetchResult.stderr,
        )}`,
      );
    }
  }

  const upstreamCounts = await commitsAgainstTargetOrDefault(
    runner,
    workingDirectory,
    upstreamTarget.upstreamRef,
  );
  if (upstreamCounts.behind === 0) {
    return {
      outcome: "up_to_date",
      output: "No upstream commits to pull",
    };
  }

  const beforeHead = await runGit(runner, workingDirectory, ["rev-parse", "HEAD"]);
  const command =
    upstreamCounts.ahead === 0
      ? {
          name: "git merge --ff-only",
          args: ["merge", "--ff-only", upstreamTarget.upstreamRef],
        }
      : {
          name: "git rebase --no-fork-point",
          args: ["rebase", "--no-fork-point", upstreamTarget.upstreamRef],
        };

  const commandResult = await runGitAllowFailure(runner, workingDirectory, command.args);
  const output = combineOptionalOutput(commandResult.stdout, commandResult.stderr);
  if (!commandResult.ok) {
    const detail = output.length > 0 ? output : `No output from ${command.name}`;
    const conflictedFiles = (await getStatusUnchecked(runner, workingDirectory))
      .filter((statusEntry) => statusEntry.status === "unmerged")
      .map((statusEntry) => statusEntry.path);
    if (conflictedFiles.length > 0) {
      return {
        outcome: "conflicts",
        conflictedFiles,
        output: detail,
      };
    }

    throw new Error(`${command.name} failed: ${detail}`);
  }

  const afterHead = await runGit(runner, workingDirectory, ["rev-parse", "HEAD"]);
  if (beforeHead === afterHead) {
    return {
      outcome: "up_to_date",
      output,
    };
  }

  return {
    outcome: "pulled",
    output,
  };
};

const commitAll = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  message: string,
): Promise<GitCommitAllResult> => {
  const commitMessage = requireNonEmpty(message, "commit message");
  const addResult = await runGitAllowFailure(runner, workingDirectory, ["add", "-A"]);
  if (!addResult.ok) {
    throw new Error(
      `git add -A failed: ${combineOptionalOutput(addResult.stdout, addResult.stderr)}`,
    );
  }

  const stagedAfterAdd = await runGit(runner, workingDirectory, [
    "diff",
    "--cached",
    "--name-only",
  ]);
  if (stagedAfterAdd.split(/\r?\n/).every((line) => line.trim().length === 0)) {
    return {
      outcome: "no_changes",
      output: "No staged changes to commit",
    };
  }

  const commitResult = await runGitAllowFailure(runner, workingDirectory, [
    "commit",
    "-m",
    commitMessage,
  ]);
  const output = combineOptionalOutput(commitResult.stdout, commitResult.stderr);
  if (!commitResult.ok) {
    throw new Error(`git commit-all failed: ${output}`);
  }

  return {
    outcome: "committed",
    commitHash: (await runGit(runner, workingDirectory, ["rev-parse", "HEAD"])).trim(),
    output,
  };
};

const rebaseBranch = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch: string,
): Promise<GitRebaseBranchResult> => {
  const target = requireNonEmpty(targetBranch, "target branch");
  const current = await getCurrentBranchUnchecked(runner, workingDirectory);
  if (current.detached) {
    throw new Error("Cannot rebase while detached");
  }

  if ((await getStatusUnchecked(runner, workingDirectory)).length > 0) {
    throw new Error("Cannot rebase with uncommitted changes");
  }

  const alreadyBased = await runGitAllowFailure(runner, workingDirectory, [
    "merge-base",
    "--is-ancestor",
    target,
    "HEAD",
  ]);
  if (alreadyBased.ok) {
    return {
      outcome: "up_to_date",
      output: "Branch already contains target history",
    };
  }

  const rebaseResult = await runGitAllowFailure(runner, workingDirectory, [
    "rebase",
    "--end-of-options",
    target,
  ]);
  const output = combineOptionalOutput(rebaseResult.stdout, rebaseResult.stderr);
  if (rebaseResult.ok) {
    return {
      outcome: "rebased",
      output,
    };
  }

  const detail = output.length > 0 ? output : "No output from git rebase";
  const conflictedFiles = (await getStatusUnchecked(runner, workingDirectory))
    .filter((statusEntry) => statusEntry.status === "unmerged")
    .map((statusEntry) => statusEntry.path);
  if (conflictedFiles.length > 0) {
    return {
      outcome: "conflicts",
      conflictedFiles,
      output: detail,
    };
  }

  throw new Error(`git rebase failed: ${detail}`);
};

const rebaseAbort = async (
  runner: GitCommandRunner,
  workingDirectory: string,
): Promise<GitRebaseAbortResult> => {
  const abortResult = await runGitAllowFailure(runner, workingDirectory, ["rebase", "--abort"]);
  const output = combineOptionalOutput(abortResult.stdout, abortResult.stderr);
  if (!abortResult.ok) {
    const detail = output.length > 0 ? output : "No output from git rebase --abort";
    throw new Error(`git rebase --abort failed: ${detail}`);
  }

  return {
    outcome: "aborted",
    output,
  };
};

const conflictAbortArgs = (operation: GitConflictOperation): string[] => {
  if (operation === "direct_merge_merge_commit") {
    return ["merge", "--abort"];
  }
  if (operation === "direct_merge_squash") {
    return ["reset", "--hard", "HEAD"];
  }

  return ["rebase", "--abort"];
};

const abortConflict = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  operation: GitConflictOperation,
): Promise<GitConflictAbortResult> => {
  const args = conflictAbortArgs(operation);
  const abortResult = await runGitAllowFailure(runner, workingDirectory, args);
  const output = combineOptionalOutput(abortResult.stdout, abortResult.stderr);
  if (!abortResult.ok) {
    const detail = output.length > 0 ? output : `No output from git ${args.join(" ")}`;
    throw new Error(`git conflict abort failed: ${detail}`);
  }

  return { output };
};

const buildWorktreeStatusData = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch: string,
  diffScope: GitDiffScope,
): Promise<GitWorktreeStatusData> => {
  const target = requireNonEmpty(targetBranch, "target branch");
  const currentBranch = await getCurrentBranchUnchecked(runner, workingDirectory);
  const upstreamTarget = await resolveUpstreamTargetForBranch(
    runner,
    workingDirectory,
    currentBranch.name,
  );
  const effectiveTargetBranch = resolveEffectiveTargetBranch(target, upstreamTarget);
  const fileStatuses = await getStatusUnchecked(runner, workingDirectory);
  const rawDiffPayload =
    diffScope === "target"
      ? effectiveTargetBranch
        ? await loadBranchChangesDiffPayload(runner, workingDirectory, effectiveTargetBranch)
        : undefined
      : await loadDiffPayload(runner, workingDirectory);
  const fileDiffs = rawDiffPayload
    ? await buildFileDiffs(
        runner,
        workingDirectory,
        fileStatuses,
        rawDiffPayload.numstat,
        rawDiffPayload.diff,
      )
    : [];
  const targetAheadBehind = await commitsAgainstTargetOrDefault(
    runner,
    workingDirectory,
    effectiveTargetBranch,
  );
  const upstreamAheadBehind = await resolveUpstreamAheadBehind(
    runner,
    workingDirectory,
    upstreamTarget,
    targetAheadBehind,
  );
  const gitConflict = await loadRebaseConflictContext(
    runner,
    workingDirectory,
    currentBranch,
    effectiveTargetBranch,
    fileStatuses,
  );

  return {
    currentBranch,
    fileStatuses,
    fileDiffs,
    targetAheadBehind,
    upstreamAheadBehind,
    ...(gitConflict ? { gitConflict } : {}),
  };
};

const buildWorktreeStatusSummaryData = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch: string,
  _diffScope: GitDiffScope,
): Promise<GitWorktreeStatusSummaryData> => {
  const target = requireNonEmpty(targetBranch, "target branch");
  const currentBranch = await getCurrentBranchUnchecked(runner, workingDirectory);
  const upstreamTarget = await resolveUpstreamTargetForBranch(
    runner,
    workingDirectory,
    currentBranch.name,
  );
  const effectiveTargetBranch = resolveEffectiveTargetBranch(target, upstreamTarget);
  const fileStatuses = await getStatusUnchecked(runner, workingDirectory);
  const targetAheadBehind = await commitsAgainstTargetOrDefault(
    runner,
    workingDirectory,
    effectiveTargetBranch,
  );
  const upstreamAheadBehind = await resolveUpstreamAheadBehind(
    runner,
    workingDirectory,
    upstreamTarget,
    targetAheadBehind,
  );
  const gitConflict = await loadRebaseConflictContext(
    runner,
    workingDirectory,
    currentBranch,
    effectiveTargetBranch,
    fileStatuses,
  );

  return {
    currentBranch,
    fileStatuses,
    fileStatusCounts: fileStatusCounts(fileStatuses),
    targetAheadBehind,
    upstreamAheadBehind,
    ...(gitConflict ? { gitConflict } : {}),
  };
};

export type CreateNodeGitPortInput = {
  processEnv?: NodeJS.ProcessEnv;
  runner?: GitCommandRunner;
};

export const createNodeGitPort = ({
  processEnv = process.env,
  runner = createDefaultGitRunner(processEnv),
}: CreateNodeGitPortInput = {}): GitPort => ({
  canonicalizePath(inputPath) {
    return realpath(inputPath);
  },
  async isGitRepository(workingDirectory) {
    const result = await runGitAllowFailure(runner, workingDirectory, [
      "rev-parse",
      "--is-inside-work-tree",
    ]);
    return result.ok && result.stdout.trim() === "true";
  },
  async shareGitCommonDirectory(repoPath, workingDir) {
    const [repoCommonDir, workingCommonDir] = await Promise.all([
      resolveGitCommonDirectory(runner, repoPath),
      resolveGitCommonDirectory(runner, workingDir),
    ]);
    return repoCommonDir === workingCommonDir;
  },
  referenceExists(workingDir, reference) {
    return referenceExists(runner, workingDir, reference);
  },
  async listRemotes(workingDirectory) {
    const remoteNames = parseRemoteNames(await runGit(runner, workingDirectory, ["remote"]));
    const remotes: GitRemote[] = [];

    for (const name of remoteNames) {
      const result = await runGitAllowFailure(runner, workingDirectory, [
        "remote",
        "get-url",
        name,
      ]);
      const url = result.stdout.trim();
      if (result.ok && url) {
        remotes.push({ name, url });
      }
    }

    return remotes;
  },
  async listBranches(workingDirectory) {
    const output = await runGit(runner, workingDirectory, [
      "for-each-ref",
      "--format=%(if)%(HEAD)%(then)1%(else)0%(end)|%(refname:short)|%(refname)",
      "refs/heads",
      "refs/remotes",
    ]);
    return parseBranchRows(output);
  },
  async getCurrentBranch(workingDirectory) {
    return getCurrentBranchUnchecked(runner, workingDirectory);
  },
  async getStatus(workingDirectory) {
    return getStatusUnchecked(runner, workingDirectory);
  },
  async getDiff(workingDirectory, targetBranch) {
    const payload = await loadDiffPayload(runner, workingDirectory, targetBranch);
    const fileStatuses = await getStatusUnchecked(runner, workingDirectory);
    return buildFileDiffs(runner, workingDirectory, fileStatuses, payload.numstat, payload.diff);
  },
  getWorktreeStatusData(workingDirectory, targetBranch, diffScope) {
    return buildWorktreeStatusData(runner, workingDirectory, targetBranch, diffScope);
  },
  getWorktreeStatusSummaryData(workingDirectory, targetBranch, diffScope) {
    return buildWorktreeStatusSummaryData(runner, workingDirectory, targetBranch, diffScope);
  },
  createWorktree(repoPath, worktreePath, branch, createBranch, startPoint) {
    return createWorktree(runner, repoPath, worktreePath, branch, createBranch, startPoint);
  },
  configureBranchUpstream(repoPath, worktreePath, branch, upstreamRemote) {
    return configureBranchUpstream(runner, repoPath, worktreePath, branch, upstreamRemote);
  },
  deleteReference(repoPath, reference) {
    return deleteReference(runner, repoPath, reference);
  },
  removeWorktree(repoPath, worktreePath, force) {
    return removeWorktree(runner, repoPath, worktreePath, force);
  },
  deleteLocalBranch(repoPath, branch, force) {
    return deleteLocalBranch(runner, repoPath, branch, force);
  },
  isAncestor(workingDirectory, ancestor, descendant) {
    return isAncestor(runner, workingDirectory, ancestor, descendant);
  },
  suggestedSquashCommitMessage(workingDirectory, sourceBranch, targetBranch) {
    return suggestedSquashCommitMessage(runner, workingDirectory, sourceBranch, targetBranch);
  },
  mergeBranch(workingDirectory, request) {
    return mergeBranch(runner, workingDirectory, request);
  },
  switchBranch(workingDirectory, branch, create) {
    return switchBranch(runner, workingDirectory, branch, create);
  },
  resetWorktreeSelection(workingDirectory, fileDiffs, selection) {
    return resetWorktreeSelection(runner, workingDirectory, fileDiffs, selection);
  },
  async commitsAheadBehind(workingDirectory, targetBranch) {
    const target = targetBranch.trim();
    if (!target) {
      throw new Error("target branch is required");
    }

    const range = `${target}...HEAD`;
    const output = await runGit(runner, workingDirectory, [
      "rev-list",
      "--count",
      "--left-right",
      "--end-of-options",
      range,
    ]);
    return parseAheadBehind(output);
  },
  fetchRemote(workingDirectory, targetBranch) {
    return fetchRemote(runner, workingDirectory, targetBranch);
  },
  pullBranch(workingDirectory) {
    return pullBranch(runner, workingDirectory);
  },
  commitAll(workingDirectory, message) {
    return commitAll(runner, workingDirectory, message);
  },
  pushBranch(workingDirectory, branch, options) {
    return pushBranch(runner, workingDirectory, branch, options);
  },
  rebaseBranch(workingDirectory, targetBranch) {
    return rebaseBranch(runner, workingDirectory, targetBranch);
  },
  rebaseAbort(workingDirectory) {
    return rebaseAbort(runner, workingDirectory);
  },
  abortConflict(workingDirectory, operation) {
    return abortConflict(runner, workingDirectory, operation);
  },
});
