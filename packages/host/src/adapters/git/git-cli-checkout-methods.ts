import { readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Effect } from "effect";
import {
  HostOperationError,
  hasNestedNodeErrorCode,
  toHostOperationError,
} from "../../effect/host-errors";
import {
  type GitCommandRunner,
  pathExists,
  readGitCheckout,
  requireNonEmptyEffect,
  runGit,
  runGitAllowFailure,
} from "../../infrastructure/git/git-command-runner";
import { createGitReadCapture } from "../../infrastructure/git/git-read-capture";
import { isListedWorktreePath, listWorktrees } from "../../infrastructure/git/git-worktree";
import type {
  GitCheckout,
  GitPort,
  GitWorktreeConfirmation,
  GitWorktreeEntry,
} from "../../ports/git-port";

type CheckoutMethods = Pick<
  GitPort,
  | "canonicalizePath"
  | "isGitRepository"
  | "getRepositoryRoot"
  | "readCheckout"
  | "isRegisteredWorktree"
  | "listWorktrees"
  | "confirmWorktree"
  | "hasGitEntry"
>;

const isMissing = (cause: unknown) => hasNestedNodeErrorCode(cause, "ENOENT");

type GitDirectoryLink = {
  /** `<root>/.git` when it is a folder, or the administrative folder that a `.git` file names. */
  gitDirectory: string;
  /** The folder that `commondir` in the Git directory names, or the Git directory itself. */
  commonDirectory: string;
  /**
   * The worktree path that `gitdir` in the administrative folder of a linked worktree names. Null
   * when the Git directory has no such record. After a manual move, the record still names the old
   * path until `git worktree repair`.
   */
  registeredWorktree: string | null;
};

/** Git ends the lines of its files with LF or CRLF. */
const withoutLineBreaks = (text: string): string => text.replace(/[\r\n]+$/u, "");

/** The content of a file without its trailing line breaks, or null when the file is missing. */
const readOptionalFile = async (file: string): Promise<string | null> => {
  try {
    return withoutLineBreaks(await readFile(file, "utf8"));
  } catch (cause) {
    if (isMissing(cause)) return null;
    throw cause;
  }
};

/**
 * Reads the `.git` entry of a checkout root like Git: a folder is the Git directory, and a file
 * names it in a `gitdir: <path>` line. Paths in these files can be relative to the folder that
 * holds the file.
 */
const readGitDirectoryLink = async (root: string): Promise<GitDirectoryLink | null> => {
  const entry = join(root, ".git");
  let gitDirectory = entry;
  try {
    const line = withoutLineBreaks(await readFile(entry, "utf8"));
    if (!line.startsWith("gitdir: ")) throw new Error(`${entry} is not a valid Git file.`);
    gitDirectory = resolve(root, line.slice("gitdir: ".length));
  } catch (cause) {
    if (isMissing(cause)) return null;
    if (!hasNestedNodeErrorCode(cause, "EISDIR")) throw cause;
  }
  gitDirectory = await realpath(gitDirectory);
  const common = await readOptionalFile(join(gitDirectory, "commondir"));
  const recorded = await readOptionalFile(join(gitDirectory, "gitdir"));
  return {
    gitDirectory,
    commonDirectory: common ? await realpath(resolve(gitDirectory, common)) : gitDirectory,
    // `gitdir` names the `.git` file of the worktree.
    registeredWorktree: recorded ? dirname(resolve(gitDirectory, recorded)) : null,
  };
};

const CONFIRMED = { kind: "confirmed" } satisfies GitWorktreeConfirmation;
const STALE = { kind: "stale" } satisfies GitWorktreeConfirmation;

/**
 * Git lists a removed worktree until a prune, and a manual move keeps the old registration. The
 * `.git` entry of the root must name the shared Git directory. A linked worktree must also have
 * its administrative folder in the `worktrees` folder that Git lists, and that folder must name
 * the root back. The main worktree has no record of its own, and its Git directory is the shared
 * one. Both paths are canonical.
 */
const confirmWorktree = async (
  root: string,
  commonDirectory: string,
): Promise<GitWorktreeConfirmation> => {
  const link = await readGitDirectoryLink(root);
  if (!link || link.commonDirectory !== commonDirectory) return STALE;
  if (link.registeredWorktree === null)
    return link.gitDirectory === commonDirectory ? CONFIRMED : STALE;
  if (dirname(link.gitDirectory) !== join(commonDirectory, "worktrees")) return STALE;
  try {
    return (await realpath(link.registeredWorktree)) === root ? CONFIRMED : STALE;
  } catch (cause) {
    if (isMissing(cause)) return STALE;
    throw cause;
  }
};

/**
 * The reads that check the directory of a Git request. Checkout and worktree list reads take
 * canonical paths, so one refresh shares them by path.
 */
export const createGitCliCheckoutMethods = (runner: GitCommandRunner) => {
  const captureCheckout = createGitReadCapture<GitCheckout | null>();
  const captureWorktrees = createGitReadCapture<GitWorktreeEntry[]>();
  const methods: CheckoutMethods = {
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
    readCheckout(directory, readContext) {
      return captureCheckout(directory, readContext, readGitCheckout(runner, directory));
    },
    isRegisteredWorktree(repoPath, worktreePath, readContext) {
      return Effect.gen(function* () {
        const target = yield* requireNonEmptyEffect(worktreePath, "worktree path");
        const worktrees = yield* captureWorktrees(
          repoPath,
          readContext,
          listWorktrees(runner, repoPath),
        );
        return yield* isListedWorktreePath(worktrees, target);
      });
    },
    listWorktrees(repoPath) {
      return listWorktrees(runner, repoPath);
    },
    confirmWorktree(root, commonDirectory) {
      return Effect.tryPromise({
        try: () => confirmWorktree(root, commonDirectory),
        catch: (cause) => toHostOperationError(cause, "git.confirmWorktree", { root }),
      }).pipe(
        Effect.catch((failure) =>
          Effect.succeed<GitWorktreeConfirmation>({ kind: "unreadable", message: failure.message }),
        ),
      );
    },
    hasGitEntry(directory) {
      return pathExists(join(directory, ".git"));
    },
  };
  return {
    methods,
    clear: () => {
      captureCheckout.clear();
      captureWorktrees.clear();
    },
  };
};
