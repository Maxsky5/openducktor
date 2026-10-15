import type {
  CommitsAheadBehind,
  FileStatus,
  GitBranch,
  GitFileStatusCounts,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { GitFileStatus } from "../../ports/git-port";
import { type GitCommandRunner, runGit, runGitAllowFailure } from "./git-command-runner";

const unmergedStatusPairs = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

const parseBranchRows = (output: string): GitBranch[] => {
  const branches = output.split("\0\n").flatMap((line): GitBranch[] => {
    if (!line) {
      return [];
    }
    const [headMarker, name, fullRef, worktreePath] = line.split("\0");
    if (!headMarker || !name || !fullRef) {
      return [];
    }
    const isRemote = fullRef.startsWith("refs/remotes/");
    if (isRemote && fullRef.endsWith("/HEAD")) {
      return [];
    }
    const branch: GitBranch = {
      name,
      isCurrent: headMarker === "1" || headMarker === "*",
      isRemote,
    };
    if (worktreePath) branch.worktreePath = worktreePath;
    return [branch];
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

export const listBranchesUnchecked = (runner: GitCommandRunner, workingDirectory: string) =>
  Effect.map(
    runGit(runner, workingDirectory, [
      "for-each-ref",
      "--format=%(if)%(HEAD)%(then)1%(else)0%(end)%00%(refname:short)%00%(refname)%00%(worktreepath)%00",
      "refs/heads",
      "refs/remotes",
    ]),
    parseBranchRows,
  );
export const parseRemoteNames = (output: string): string[] =>
  output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
export const parseAheadBehind = (output: string): CommitsAheadBehind => {
  const [behindRaw, aheadRaw] = output.trim().split(/\s+/, 2);
  const behind = Number.parseInt(behindRaw ?? "", 10);
  const ahead = Number.parseInt(aheadRaw ?? "", 10);
  if (!Number.isFinite(behind) || !Number.isFinite(ahead)) {
    throw new HostValidationError({
      message: `Unable to parse git ahead/behind counts: ${output.trim()}`,
      field: "aheadBehind",
      details: { output: output.trim() },
    });
  }
  return { ahead, behind };
};
export const porcelainCharToStatus = (value: string): string => {
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

export const isUnmergedStatusPair = (index: string, worktree: string): boolean => {
  const pair = `${index}${worktree}`;
  return unmergedStatusPairs.has(pair);
};

/** One porcelain v1 record with both status columns. */
export type PorcelainEntry = {
  index: string;
  worktree: string;
  path: string;
  originalPath?: string;
};

const parsePorcelainRecord = (line: string): PorcelainEntry[] => {
  if (line.length < 4) {
    return [];
  }
  const index = line.at(0) ?? "";
  const worktree = line.at(1) ?? "";
  const filePath = line.slice(3);
  // Git ends an untracked nested repository path with a slash.
  const untracked = index === "?" && worktree === "?";
  const path = untracked && filePath.endsWith("/") ? filePath.slice(0, -1) : filePath;
  return [{ index, worktree, path }];
};

export const parsePorcelainEntries = (output: string): PorcelainEntry[] => {
  if (!output.includes("\0")) {
    return output.split(/\r?\n/).flatMap(parsePorcelainRecord);
  }

  const records = output.split("\0");
  const entries: PorcelainEntry[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? "";
    const parsed = parsePorcelainRecord(record);
    if (!"RC".includes(record.at(0) ?? " ") && !"RC".includes(record.at(1) ?? " ")) {
      entries.push(...parsed);
      continue;
    }
    const originalPath = records[index + 1] ?? "";
    entries.push(...parsed.map((entry) => (originalPath ? { ...entry, originalPath } : entry)));
    index += 1;
  }
  return entries;
};

/** The status of one entry, as the HEAD worktree status shows it. */
export const statusFromEntry = ({
  index,
  worktree,
  path,
  originalPath,
}: PorcelainEntry): GitFileStatus => {
  const status = (value: string, staged: boolean): GitFileStatus =>
    originalPath ? { path, status: value, staged, originalPath } : { path, status: value, staged };
  if (index === "?" && worktree === "?") return status("untracked", false);
  if (index === "!" && worktree === "!") return status("ignored", false);
  if (isUnmergedStatusPair(index, worktree)) return status("unmerged", true);
  if (worktree === "D" || worktree === "T") return status(porcelainCharToStatus(worktree), false);
  if (index !== " " && worktree === " ") return status(porcelainCharToStatus(index), true);
  if (index === " " && worktree !== " ") return status(porcelainCharToStatus(worktree), false);
  return status(porcelainCharToStatus(index), true);
};

/** One status for each changed path, as the HEAD worktree status shows it. */
const parseStatusPorcelain = (output: string): GitFileStatus[] =>
  parsePorcelainEntries(output).map(statusFromEntry);
export const fileStatusCounts = (fileStatuses: FileStatus[]): GitFileStatusCounts => {
  const total = fileStatuses.length;
  const staged = fileStatuses.filter((status) => status.staged).length;
  return { total, staged, unstaged: total - staged };
};
export const getCurrentBranchUnchecked = (runner: GitCommandRunner, workingDirectory: string) =>
  Effect.gen(function* () {
    const output = yield* runGit(runner, workingDirectory, ["branch", "--show-current"]);
    const name = output
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0)
      ?.trim();
    const revisionResult = yield* runGitAllowFailure(runner, workingDirectory, [
      "rev-parse",
      "HEAD",
    ]);
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
  });
/**
 * Rename detection does not follow `status.renames`, so the status and the diff reads of the local
 * changes pair the same rename paths. A file action on a rename then changes both of its paths.
 */
export const readStatusPorcelain = (runner: GitCommandRunner, workingDirectory: string) =>
  runGit(runner, workingDirectory, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--find-renames",
  ]);
/** Commits must not stage or record a path that still has an unresolved conflict. */
export const requireNoUnmergedPaths = (runner: GitCommandRunner, workingDirectory: string) =>
  Effect.gen(function* () {
    const statuses = parseStatusPorcelain(yield* readStatusPorcelain(runner, workingDirectory));
    if (statuses.some((status) => status.status === "unmerged")) {
      return yield* Effect.fail(
        new HostValidationError({ message: "Resolve the conflicted files before you commit." }),
      );
    }
  });
export const getStatusUnchecked = (runner: GitCommandRunner, workingDirectory: string) =>
  Effect.map(readStatusPorcelain(runner, workingDirectory), parseStatusPorcelain);
