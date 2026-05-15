import type {
  CommitsAheadBehind,
  FileStatus,
  GitBranch,
  GitCurrentBranch,
  GitFileStatusCounts,
} from "@openducktor/contracts";
import { type GitCommandRunner, runGit, runGitAllowFailure } from "./git-command-runner";

export const parseBranchRows = (output: string): GitBranch[] => {
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
    throw new Error(`Unable to parse git ahead/behind counts: ${output.trim()}`);
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

export const parseStatusPorcelain = (output: string): FileStatus[] =>
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

export const fileStatusCounts = (fileStatuses: FileStatus[]): GitFileStatusCounts => {
  const total = fileStatuses.length;
  const staged = fileStatuses.filter((status) => status.staged).length;
  return { total, staged, unstaged: total - staged };
};

export const getCurrentBranchUnchecked = async (
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

export const getStatusUnchecked = async (
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
