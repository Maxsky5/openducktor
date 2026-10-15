import type { GitCommitAllResult, GitCurrentBranch } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { GitFileStatus, GitLocalChangesData, GitPortError } from "../../ports/git-port";
import {
  combineOutput,
  type GitCommandRunner,
  requireNonEmptyEffect,
  runGit,
  runGitAllowFailure,
} from "./git-command-runner";
import { buildFileDiffs } from "./git-diff";
import {
  isUnmergedStatusPair,
  type PorcelainEntry,
  parsePorcelainEntries,
  porcelainCharToStatus,
  requireNoUnmergedPaths,
  statusFromEntry,
} from "./git-status";
import {
  loadRebaseConflictContext,
  resolveTrackedUpstreamReference,
  resolveUpstreamAheadBehind,
} from "./git-upstream";

type LocalChangeReads = {
  branch: () => Effect.Effect<GitCurrentBranch, GitPortError>;
  statusOutput: () => Effect.Effect<string, GitPortError>;
};

/** A write fails with this text when the reviewed content differs from Git now. */
export const STALE_SELECTION_MESSAGE =
  "The displayed changes are out of date. Refresh and review them.";

export const invalid = (message: string, field?: string): HostValidationError =>
  new HostValidationError(field === undefined ? { message } : { message, field });

/**
 * Options for every local diff read. Text conversion and external diff drivers change hunks for
 * human review, so a chunk shown with them can differ from the patch that Git applies. A
 * `diff.submodule` setting can replace the submodule entry. Display and write reads use the same
 * options, so a chunk index names the same hunk in both.
 */
export const RAW_DIFF_OPTIONS = [
  // The status read finds renames too, whatever `diff.renames` holds.
  "--find-renames",
  "--full-index",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--submodule=short",
];

/** A pathspec that matches one repository-relative path, with no wildcard. */
export const literal = (filePath: string): string => `:(top,literal)${filePath}`;

/** Reads both porcelain columns, so a partly staged path belongs to both groups. */
const classifyStatusEntries = (entries: PorcelainEntry[]) => {
  const unstaged: GitFileStatus[] = [];
  const staged: GitFileStatus[] = [];
  const conflicted: GitFileStatus[] = [];
  for (const entry of entries) {
    if (entry.index === "!") continue;
    if (isUnmergedStatusPair(entry.index, entry.worktree)) {
      conflicted.push({ path: entry.path, status: "unmerged", staged: false });
      continue;
    }
    if (entry.index === "?") {
      unstaged.push({ path: entry.path, status: "untracked", staged: false });
      continue;
    }
    if (entry.index !== " ") {
      const status: GitFileStatus = {
        path: entry.path,
        status: porcelainCharToStatus(entry.index),
        staged: true,
      };
      if (entry.originalPath && "RC".includes(entry.index)) {
        status.originalPath = entry.originalPath;
      }
      staged.push(status);
    }
    if (entry.worktree !== " ") {
      const status: GitFileStatus = {
        path: entry.path,
        status: porcelainCharToStatus(entry.worktree),
        staged: false,
      };
      // Git reports a worktree rename only for an intent-to-add destination.
      if (entry.originalPath && entry.worktree === "R") status.originalPath = entry.originalPath;
      unstaged.push(status);
    }
  }
  return { unstaged, staged, conflicted };
};

/** Unmerged paths show a combined diff that the file diff parser cannot read. */
const excludePathspec = (excludedPaths: string[]): string[] =>
  excludedPaths.length === 0
    ? []
    : ["--", ":(top)", ...excludedPaths.map((excluded) => `:(top,exclude,literal)${excluded}`)];

const loadGroupDiffs = (
  runner: GitCommandRunner,
  workingDirectory: string,
  fileStatuses: GitFileStatus[],
  diffArgs: string[],
  pathspec: string[],
) =>
  Effect.gen(function* () {
    const args = ["diff", ...RAW_DIFF_OPTIONS, ...diffArgs];
    const [numstat, patch] = yield* Effect.all(
      [
        runGit(runner, workingDirectory, [...args, "--numstat", "-z", ...pathspec]),
        runGit(runner, workingDirectory, [...args, ...pathspec]),
      ],
      { concurrency: "unbounded" },
    );
    return yield* buildFileDiffs(runner, workingDirectory, fileStatuses, numstat, patch, {
      fullIndex: true,
    });
  });

export const loadLocalChanges = (
  runner: GitCommandRunner,
  workingDirectory: string,
  reads: LocalChangeReads,
): Effect.Effect<GitLocalChangesData, GitPortError> =>
  Effect.gen(function* () {
    // Reads run with optional locks off, so independent reads run at the same time.
    const [currentBranch, statusOutput] = yield* Effect.all(
      [reads.branch(), reads.statusOutput()],
      {
        concurrency: "unbounded",
      },
    );
    const entries = parsePorcelainEntries(statusOutput);
    const fileStatuses = entries.map(statusFromEntry);
    const groups = classifyStatusEntries(entries);
    const conflictedPaths = groups.conflicted.map((status) => status.path);
    const excluded = excludePathspec(conflictedPaths);
    const [unstagedDiffs, stagedDiffs, conflictedDiffs, upstreamAheadBehind, gitConflict] =
      yield* Effect.all(
        [
          loadGroupDiffs(runner, workingDirectory, groups.unstaged, [], excluded),
          loadGroupDiffs(runner, workingDirectory, groups.staged, ["--cached"], excluded),
          conflictedPaths.length > 0 && currentBranch.revision
            ? loadGroupDiffs(
                runner,
                workingDirectory,
                groups.conflicted,
                ["HEAD"],
                ["--", ...conflictedPaths.map(literal)],
              )
            : Effect.succeed([]),
          resolveTrackedUpstreamReference(runner, workingDirectory, currentBranch.name).pipe(
            Effect.flatMap((upstreamTarget) =>
              resolveUpstreamAheadBehind(
                runner,
                workingDirectory,
                upstreamTarget,
                currentBranch.revision,
              ),
            ),
          ),
          loadRebaseConflictContext(runner, workingDirectory, currentBranch, fileStatuses),
        ],
        { concurrency: "unbounded" },
      );
    const changes: GitLocalChangesData = {
      currentBranch,
      fileStatuses,
      unstaged: { fileStatuses: groups.unstaged, fileDiffs: unstagedDiffs },
      staged: { fileStatuses: groups.staged, fileDiffs: stagedDiffs },
      conflicted: { fileStatuses: groups.conflicted, fileDiffs: conflictedDiffs },
      upstreamAheadBehind,
    };
    return gitConflict ? { ...changes, gitConflict } : changes;
  });

export const commitStaged = (
  runner: GitCommandRunner,
  workingDirectory: string,
  message: string,
): Effect.Effect<GitCommitAllResult, GitPortError> =>
  Effect.gen(function* () {
    const commitMessage = yield* requireNonEmptyEffect(message, "commit message");
    yield* requireNoUnmergedPaths(runner, workingDirectory);
    const staged = yield* runGitAllowFailure(runner, workingDirectory, [
      "diff",
      "--cached",
      "--quiet",
    ]);
    if (staged.ok) {
      return { outcome: "no_changes", output: "No staged changes to commit" };
    }
    if (staged.exitCode !== 1) {
      return yield* Effect.fail(
        new HostOperationError({
          operation: "git.diff.cached",
          message: `git diff --cached failed: ${combineOutput(staged.stdout, staged.stderr)}`,
        }),
      );
    }
    const commit = yield* runGitAllowFailure(runner, workingDirectory, [
      "commit",
      "-m",
      commitMessage,
    ]);
    const output = combineOutput(commit.stdout, commit.stderr);
    if (!commit.ok) {
      return yield* Effect.fail(
        new HostOperationError({
          operation: "git.commit",
          message: `git commit failed: ${output}`,
        }),
      );
    }
    return {
      outcome: "committed",
      commitHash: (yield* runGit(runner, workingDirectory, ["rev-parse", "HEAD"])).trim(),
      output,
    };
  });
