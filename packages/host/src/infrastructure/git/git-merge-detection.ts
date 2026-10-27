import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { GitPort, GitReflogEntry, GitRefTip } from "../../ports/git-port";
import {
  combineOutput,
  type GitCommandError,
  type GitCommandRunner,
  runGit,
  runGitAllowFailure,
  runGitWithStdin,
  runGitWithStdinAllowFailure,
} from "./git-command-runner";

/** Git before 2.41 does not know the `ahead-behind` atom of `for-each-ref`. */
const OLD_GIT_AHEAD_BEHIND_OUTPUT = "unknown field name: ahead-behind";

/** The merge detection methods of the Git port. */
export const createGitMergeDetectionMethods = (
  runner: GitCommandRunner,
): Pick<GitPort, "listRefTips" | "countCommitsAhead" | "mergeTreeOids" | "readReflogs"> => ({
  listRefTips: (repoPath, patterns) => listRefTips(runner, repoPath, patterns),
  countCommitsAhead: (repoPath, base, patterns) =>
    countCommitsAhead(runner, repoPath, base, patterns),
  mergeTreeOids: (repoPath, pairs) => mergeTreeOids(runner, repoPath, pairs),
  readReflogs: (repoPath, refs) => readReflogs(runner, repoPath, refs),
});

const listRefTips = (
  runner: GitCommandRunner,
  repoPath: string,
  patterns: string[],
): Effect.Effect<GitRefTip[], GitCommandError> =>
  Effect.gen(function* () {
    if (patterns.length === 0) return [];
    const output = yield* runGit(runner, repoPath, [
      "for-each-ref",
      "--format=%(objectname)%00%(tree)%00%(refname)%00%(worktreepath)",
      ...patterns,
    ]);
    const tips: GitRefTip[] = [];
    for (const line of output.split("\n")) {
      if (line.length === 0) continue;
      const [oid = "", treeOid = "", ref = "", worktreePath = ""] = line.split("\0");
      if (!oid || !ref) {
        return yield* new HostOperationError({
          operation: "git.for-each-ref",
          message: `git for-each-ref returned an invalid line: ${line}`,
          details: { repoPath },
        });
      }
      tips.push({ ref, oid, treeOid, worktreePath: worktreePath || null });
    }
    return tips;
  });

/**
 * The number of commits that `base` does not have, for each ref that the patterns match, in one
 * Git call. A ref that `base` holds has 0. It needs Git 2.41 or later.
 */
const countCommitsAhead = (
  runner: GitCommandRunner,
  repoPath: string,
  base: string,
  patterns: string[],
): Effect.Effect<Map<string, number>, GitCommandError> =>
  Effect.gen(function* () {
    const counts = new Map<string, number>();
    if (patterns.length === 0) return counts;
    const result = yield* runGitAllowFailure(runner, repoPath, [
      "for-each-ref",
      `--format=%(refname)%00%(ahead-behind:${base})`,
      ...patterns,
    ]);
    const output = combineOutput(result.stdout, result.stderr);
    if (!result.ok) {
      return yield* new HostOperationError({
        operation: "git.for-each-ref",
        message: output.includes(OLD_GIT_AHEAD_BEHIND_OUTPUT)
          ? "Merge detection needs Git 2.41 or later. Update Git, or close the task by hand."
          : `git for-each-ref failed: ${output}`,
        details: { repoPath, base },
      });
    }
    for (const line of result.stdout.split("\n")) {
      if (line.length === 0) continue;
      const [ref = "", aheadBehind = ""] = line.split("\0");
      const ahead = /^(\d+) \d+$/.exec(aheadBehind)?.[1];
      if (ahead === undefined) {
        return yield* new HostOperationError({
          operation: "git.for-each-ref",
          message: `git for-each-ref returned an invalid ahead-behind line: ${line}`,
          details: { repoPath, base },
        });
      }
      counts.set(ref, Number(ahead));
    }
    return counts;
  });

/**
 * The tree of a clean merge of each pair, in one Git call: `second` merged into `first`. A merge
 * with conflicts gives null.
 */
const mergeTreeOids = (
  runner: GitCommandRunner,
  repoPath: string,
  pairs: readonly { first: string; second: string }[],
): Effect.Effect<(string | null)[], GitCommandError> =>
  Effect.gen(function* () {
    if (pairs.length === 0) return [];
    const result = yield* runGitWithStdinAllowFailure(
      runner,
      repoPath,
      ["merge-tree", "--write-tree", "--stdin", "--name-only", "--no-messages"],
      pairs.map(({ first, second }) => `${first} ${second}\n`).join(""),
    );
    const trees = result.ok ? parseMergeTreeRecords(result.stdout) : null;
    // With `--stdin`, a clean and a conflicted merge both exit with 0.
    if (trees === null || trees.length !== pairs.length) {
      return yield* new HostOperationError({
        operation: "git.merge-tree",
        message: `git merge-tree failed: ${combineOutput(result.stdout, result.stderr)}`,
        details: { repoPath },
      });
    }
    return trees;
  });

/**
 * The records of `merge-tree --stdin --name-only --no-messages`: a status, the tree, the
 * conflicted paths, then an empty field. Status 1 is a clean merge and 0 a merge with conflicts.
 * Null for output in another form.
 */
const parseMergeTreeRecords = (stdout: string): (string | null)[] | null => {
  const fields = stdout.split("\0");
  const trees: (string | null)[] = [];
  let index = 0;
  // The output ends with the empty field of the last record, so one empty field remains.
  while (index < fields.length - 1) {
    const status = fields[index];
    const tree = fields[index + 1];
    if ((status !== "0" && status !== "1") || !tree) return null;
    index += 2;
    while (index < fields.length && fields[index] !== "") index += 1;
    if (index >= fields.length) return null;
    index += 1;
    trees.push(status === "1" ? tree : null);
  }
  return trees;
};

/**
 * The reflog entries of each reference, newest first, in one Git call. The walk mixes the entries
 * of all references by time, and keeps the newest first order of each one. A reference without a
 * reflog adds no line.
 */
const readReflogs = (
  runner: GitCommandRunner,
  repoPath: string,
  refs: readonly string[],
): Effect.Effect<Map<string, GitReflogEntry[]>, GitCommandError> =>
  Effect.gen(function* () {
    const reflogs = new Map<string, GitReflogEntry[]>();
    if (refs.length === 0) return reflogs;
    // The references go on stdin, so many tasks do not make a command line that is too long.
    const output = yield* runGitWithStdin(
      runner,
      repoPath,
      [
        "log",
        "-g",
        "--format=%gD%x00%H%x00%gs",
        // `log.showSignature` adds signature lines that are not reflog entries.
        "--no-show-signature",
        "--stdin",
        "--",
      ],
      refs.map((ref) => `${ref}\n`).join(""),
    );
    for (const line of output.split("\n")) {
      if (line.length === 0) continue;
      // `%gD` is the reference and the entry index, such as `refs/heads/task@{0}`. A reference name
      // cannot hold `@{`.
      const [selector = "", oid = "", subject = ""] = line.split("\0");
      const ref = selector.slice(0, selector.lastIndexOf("@{"));
      if (!ref || !oid) {
        return yield* new HostOperationError({
          operation: "git.log",
          message: `git log -g returned an invalid reflog line: ${line}`,
          details: { repoPath },
        });
      }
      const entries = reflogs.get(ref);
      if (entries) entries.push({ oid, subject });
      else reflogs.set(ref, [{ oid, subject }]);
    }
    return reflogs;
  });
