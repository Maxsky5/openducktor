import { Buffer } from "node:buffer";
import { realpath } from "node:fs/promises";
import { Effect } from "effect";
import { resolveTrackedUpstreamReference } from "../../infrastructure/git/git-upstream";
import {
  HostOperationError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import { readFileTreeContext } from "../../infrastructure/git/git-file-tree-context";
import { createGitReadCapture } from "../../infrastructure/git/git-read-capture";
import type { GitReadContext, GitCurrentBranch } from "@openducktor/contracts";
import type { GitFileStatus, GitChangedFile } from "../../ports/git-port";
import { loadChangedFiles } from "../../infrastructure/git/git-changed-files";
import {
  createDefaultGitRunner,
  type GitCommandRunner,
  type ResolveGitCommand,
  referenceExists,
  resolveGitCommonDirectory,
  runGit,
  runGitAllowFailure,
} from "../../infrastructure/git/git-command-runner";
import { buildFileDiffs, loadDiffPayload } from "../../infrastructure/git/git-diff";
import {
  isAncestor,
  mergeBranch,
  suggestedSquashCommitMessage,
  switchBranch,
} from "../../infrastructure/git/git-merge";
import {
  resetWorktreeSelection,
  restoreWorktreeToReference,
} from "../../infrastructure/git/git-reset";
import {
  getCurrentBranchUnchecked,
  getStatusUnchecked,
  parseAheadBehind,
  listBranchesUnchecked,
  parseRemoteNames,
} from "../../infrastructure/git/git-status";
import {
  abortConflict,
  commitAll,
  fetchRemote,
  pullBranch,
  pushBranch,
  rebaseAbort,
  rebaseBranch,
} from "../../infrastructure/git/git-sync";
import {
  configureBranchUpstream,
  createWorktree,
  deleteLocalBranch,
  deleteReference,
  isRegisteredWorktree,
  listWorktrees,
  removeWorktree,
} from "../../infrastructure/git/git-worktree";
import {
  buildWorktreeStatusData,
  buildWorktreeStatusSummaryData,
} from "../../infrastructure/git/git-worktree-status";
import type { GitFileListEntry, GitPort, GitRemote, GitRemoteEndpoint } from "../../ports/git-port";

export type {
  GitCommandResult,
  GitCommandRunner,
} from "../../infrastructure/git/git-command-runner";

export type CreateGitCliAdapterInput = (
  | { resolveCommand?: never; runner: GitCommandRunner }
  | { resolveCommand: ResolveGitCommand; runner?: never }
) & {
  readEnv?: () => NodeJS.ProcessEnv;
};

const FILE_LIST_ARGS = ["ls-files", "-t", "-s", "-co", "-k", "--exclude-standard", "-z", "--"];

const parseMaterializedGitFiles = (
  output: string,
): Effect.Effect<GitFileListEntry[], HostOperationError<{ entry: string }>> =>
  Effect.gen(function* () {
    const filesByPath = new Map<string, GitFileListEntry>();
    for (const entry of output.split("\0")) {
      if (entry.length === 0) {
        continue;
      }
      if (entry.length < 3 || entry[1] !== " ") {
        return yield* Effect.fail(
          new HostOperationError({
            operation: "git.listFiles",
            message: "Git returned an invalid tagged file entry.",
            details: { entry },
          }),
        );
      }
      const tag = entry[0];
      if (tag === "S") {
        continue;
      }
      if (tag === "K") {
        const path = entry.slice(2);
        const isDirectory = path.endsWith("/");
        const normalizedPath = isDirectory ? path.slice(0, -1) : path;
        const worktreeKind = isDirectory ? "directory" : "file";
        const listedEntry = filesByPath.get(normalizedPath);
        filesByPath.set(normalizedPath, {
          kind: listedEntry?.kind ?? worktreeKind,
          path: normalizedPath,
          worktreeKind,
        });
        continue;
      }
      if (tag === "?") {
        const path = entry.slice(2);
        const isDirectory = path.endsWith("/");
        const normalizedPath = isDirectory ? path.slice(0, -1) : path;
        filesByPath.set(normalizedPath, {
          kind: isDirectory ? "directory" : "file",
          path: normalizedPath,
        });
        continue;
      }
      const stagedEntry = /^(\d{6}) [0-9a-f]+ \d\t(.+)$/su.exec(entry.slice(2));
      if (!stagedEntry) {
        return yield* Effect.fail(
          new HostOperationError({
            operation: "git.listFiles",
            message: "Git returned an invalid staged file entry.",
            details: { entry },
          }),
        );
      }
      const path = stagedEntry[2]!;
      const worktreeKind = filesByPath.get(path)?.worktreeKind;
      const listedFile: GitFileListEntry = {
        kind: stagedEntry[1] === "160000" ? "directory" : "file",
        path,
      };
      if (worktreeKind) {
        listedFile.worktreeKind = worktreeKind;
      }
      filesByPath.set(path, listedFile);
    }
    return [...filesByPath.values()];
  });

export const createGitCliAdapter = (input: CreateGitCliAdapterInput): GitPort => {
  const readEnv = input.readEnv ?? (() => process.env);
  const runner =
    input.runner ?? createDefaultGitRunner(readEnv, { resolveCommand: input.resolveCommand });

  const captureStatus = createGitReadCapture<GitFileStatus[]>();
  const captureBranch = createGitReadCapture<GitCurrentBranch>();
  const captureChanges = createGitReadCapture<GitChangedFile[]>();
  const captureIdentity = (dir: string) =>
    runGit(runner, dir, ["rev-parse", "--absolute-git-dir"]).pipe(
      Effect.flatMap((output) =>
        Effect.tryPromise({
          try: () => realpath(output.trim()),
          catch: (cause) => toHostOperationError(cause, "git.readContext"),
        }),
      ),
    );
  const status = (dir: string, context?: GitReadContext) =>
    Effect.gen(function* () {
      if (!context) return yield* getStatusUnchecked(runner, dir);
      return yield* captureStatus(
        yield* captureIdentity(dir),
        context,
        getStatusUnchecked(runner, dir),
      );
    });
  const branch = (dir: string, context?: GitReadContext) =>
    Effect.gen(function* () {
      if (!context) return yield* getCurrentBranchUnchecked(runner, dir);
      return yield* captureBranch(
        yield* captureIdentity(dir),
        context,
        getCurrentBranchUnchecked(runner, dir),
      );
    });
  return {
    releaseReadCaptures: () =>
      Effect.sync(() => {
        captureStatus.clear();
        captureBranch.clear();
        captureChanges.clear();
      }),
    getFileTreeContext: (dir, target) => readFileTreeContext(runner, dir, target),
    listFileRegions(dir, regions) {
      return Effect.gen(function* () {
        const files = new Map<string, GitFileListEntry>();
        for (const args of regionCommands(regions)) {
          const output = yield* runGit(runner, dir, args);
          const batch = yield* parseMaterializedGitFiles(output);
          for (const file of batch) files.set(file.path, file);
        }
        return [...files.values()];
      });
    },
    canonicalizePath(inputPath) {
      return Effect.tryPromise({
        try: () => realpath(inputPath),
        catch: (cause) =>
          toHostOperationError(cause, "git.canonicalizePath", {
            path: inputPath,
          }),
      });
    },
    isGitRepository(workingDirectory) {
      return Effect.gen(function* () {
        const result = yield* runGitAllowFailure(runner, workingDirectory, [
          "rev-parse",
          "--is-inside-work-tree",
        ]);
        return result.ok && result.stdout.trim() === "true";
      });
    },
    getRepositoryRoot(workingDirectory) {
      return Effect.gen(function* () {
        const output = yield* runGit(runner, workingDirectory, ["rev-parse", "--show-toplevel"]);
        const repositoryRoot = output.replace(/\r?\n$/u, "");
        if (!repositoryRoot) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "git.rev-parse.show-toplevel",
              message: "Git returned an empty repository root.",
            }),
          );
        }
        return repositoryRoot;
      });
    },
    shareGitCommonDirectory(repoPath, workingDir) {
      return Effect.gen(function* () {
        const [repoCommonDir, workingCommonDir] = yield* Effect.all([
          resolveGitCommonDirectory(runner, repoPath),
          resolveGitCommonDirectory(runner, workingDir),
        ]);
        return repoCommonDir === workingCommonDir;
      });
    },
    isRegisteredWorktree(repoPath, worktreePath) {
      return isRegisteredWorktree(runner, repoPath, worktreePath);
    },
    listWorktrees(repoPath) {
      return listWorktrees(runner, repoPath);
    },
    getTrackedUpstreamReference(workingDir) {
      return Effect.gen(function* () {
        const branch = yield* getCurrentBranchUnchecked(runner, workingDir);
        const reference = yield* resolveTrackedUpstreamReference(runner, workingDir, branch.name);
        return reference ?? null;
      });
    },
    referenceExists(workingDir, reference) {
      return referenceExists(runner, workingDir, reference);
    },
    listRemotes(workingDirectory) {
      return Effect.gen(function* () {
        const remoteNames = parseRemoteNames(yield* runGit(runner, workingDirectory, ["remote"]));
        const remotes: GitRemote[] = [];

        for (const name of remoteNames) {
          const result = yield* runGitAllowFailure(runner, workingDirectory, [
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
      });
    },
    listRemoteEndpoints(workingDirectory) {
      return Effect.gen(function* () {
        const remoteNames = parseRemoteNames(yield* runGit(runner, workingDirectory, ["remote"]));
        const remotes: GitRemoteEndpoint[] = [];
        for (const name of remoteNames) {
          const fetchUrls = parseRemoteUrls(
            yield* runGit(runner, workingDirectory, ["remote", "get-url", "--all", name]),
          );
          const pushUrls = parseRemoteUrls(
            yield* runGit(runner, workingDirectory, ["remote", "get-url", "--push", "--all", name]),
          );
          if (fetchUrls.length === 0 || pushUrls.length === 0) {
            return yield* Effect.fail(
              new HostOperationError({
                operation: "git.remote.get-url",
                message: `Git remote '${name}' did not return both fetch and push URLs.`,
                details: { name },
              }),
            );
          }
          remotes.push({ name, fetchUrls, pushUrls });
        }
        return remotes;
      });
    },
    listBranches(workingDirectory) {
      return listBranchesUnchecked(runner, workingDirectory);
    },
    listFiles(workingDirectory, relativePath, options) {
      return Effect.gen(function* () {
        const pathspec =
          relativePath === undefined
            ? "."
            : `:(${options?.caseInsensitive ? "icase," : ""}literal)${relativePath}`;
        const output = yield* runGit(runner, workingDirectory, [...FILE_LIST_ARGS, pathspec]);
        return yield* parseMaterializedGitFiles(output);
      });
    },
    getCurrentBranch(workingDirectory, context) {
      return branch(workingDirectory, context);
    },
    getStatus(workingDirectory, context) {
      return status(workingDirectory, context);
    },
    listChangedFiles(workingDirectory, targetBranch, context) {
      return Effect.gen(function* () {
        if (!context) return yield* loadChangedFiles(runner, workingDirectory, targetBranch);
        const identity = yield* captureIdentity(workingDirectory);
        return yield* captureChanges(
          JSON.stringify([identity, targetBranch]),
          context,
          loadChangedFiles(runner, workingDirectory, targetBranch),
        );
      });
    },
    getDiff(workingDirectory, targetBranch) {
      return Effect.gen(function* () {
        const payload = yield* loadDiffPayload(runner, workingDirectory, targetBranch);
        const fileStatuses = yield* getStatusUnchecked(runner, workingDirectory);
        return yield* buildFileDiffs(
          runner,
          workingDirectory,
          fileStatuses,
          payload.numstat,
          payload.diff,
        );
      });
    },
    getWorktreeStatusData(workingDirectory, targetBranch, diffScope, context) {
      return buildWorktreeStatusData(runner, workingDirectory, targetBranch, diffScope, {
        branch: () => branch(workingDirectory, context),
        status: () => status(workingDirectory, context),
      });
    },
    getWorktreeStatusSummaryData(workingDirectory, targetBranch, diffScope, context) {
      return buildWorktreeStatusSummaryData(runner, workingDirectory, targetBranch, diffScope, {
        branch: () => branch(workingDirectory, context),
        status: () => status(workingDirectory, context),
      });
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
    restoreWorktreeToReference(workingDirectory, reference) {
      return restoreWorktreeToReference(runner, workingDirectory, reference);
    },
    commitsAheadBehind(workingDirectory, targetBranch) {
      return Effect.gen(function* () {
        const target = targetBranch.trim();
        if (!target) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "targetBranch",
              message: "target branch is required",
            }),
          );
        }

        const range = `${target}...HEAD`;
        const output = yield* runGit(runner, workingDirectory, [
          "rev-list",
          "--count",
          "--left-right",
          "--end-of-options",
          range,
        ]);
        return yield* Effect.try({
          try: () => parseAheadBehind(output),
          catch: (cause) =>
            cause instanceof HostValidationError
              ? cause
              : toHostOperationError(cause, "git.parseAheadBehind"),
        });
      });
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
  };
};

function* regionCommands(regions: string[]): Generator<string[]> {
  const windows = process.platform === "win32";
  // Leave room for the executable and environment. Windows scripts also add UTF-16 quoting and argument names.
  const limit = windows ? 16 * 1024 : 64 * 1024;
  const size = (arg: string) =>
    windows ? Buffer.byteLength(arg, "utf8") * 4 + 64 : Buffer.byteLength(arg, "utf8") + 16;
  const prefixSize = FILE_LIST_ARGS.reduce((total, arg) => total + size(arg), 0);
  let args = [...FILE_LIST_ARGS];
  let bytes = prefixSize;
  for (const path of regions) {
    const arg = `:(literal)${path}`;
    const argSize = size(arg);
    if (args.length > FILE_LIST_ARGS.length && bytes + argSize > limit) {
      yield args;
      args = [...FILE_LIST_ARGS];
      bytes = prefixSize;
    }
    args.push(arg);
    bytes += argSize;
  }
  if (args.length > FILE_LIST_ARGS.length) yield args;
}

const parseRemoteUrls = (output: string): string[] =>
  output
    .split(/\r?\n/u)
    .map((url) => url.trim())
    .filter(Boolean);
