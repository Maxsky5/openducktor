import type { GitHistoryCommit, GitHistoryPage, GitHistoryRef } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  HostOperationError,
  HostResourceError,
  HostValidationError,
} from "../../effect/host-errors";
import type { GitHistoryPageInput, GitPortError } from "../../ports/git-port";
import {
  combineOptionalOutput,
  combineOutput,
  type GitCommandRunner,
  runGit,
  runGitAllowFailure,
} from "./git-command-runner";

export const GIT_HISTORY_PAGE_SIZE = 100;

const FIELD = "\u0000";
const RECORD = "\u001e";
const LOG_FORMAT = ["%H", "%P", "%an", "%ae", "%aI", "%s", "%B"].join("%x00") + "%x1e";
const REF_FORMAT = ["%(objectname)", "%(*objectname)", "%(refname)", "%(HEAD)", "%(symref)"].join(
  "%00",
);
const REF_KINDS = [
  ["refs/heads/", "local"],
  ["refs/remotes/", "remote"],
  ["refs/tags/", "tag"],
] as const;
const REF_ORDER = { local: 0, remote: 1, tag: 2 } satisfies Record<GitHistoryRef["kind"], number>;

const splitLines = (output: string): string[] =>
  output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

const resolveTargetTip = (runner: GitCommandRunner, workingDirectory: string, reference: string) =>
  Effect.gen(function* () {
    const result = yield* runGitAllowFailure(runner, workingDirectory, [
      "rev-parse",
      "--verify",
      "--quiet",
      "--end-of-options",
      `${reference}^{commit}`,
    ]);
    const tip = result.stdout.trim();
    if (!result.ok || !tip) {
      return yield* Effect.fail(
        new HostResourceError({
          resource: reference,
          operation: "git.history.target",
          message: `Comparison branch ${reference} is unavailable. Refresh to fetch it, or choose another target.`,
        }),
      );
    }
    return tip;
  });

const unreadableHead = (detail: string) =>
  new HostOperationError({
    operation: "git.history.head",
    message: `Git cannot read the current commit: ${detail} Repair the branch reference, then refresh.`,
  });

/**
 * Git has no HEAD commit on a branch before its first commit. Then HEAD names a branch that has
 * no reference. Git warns about a reference that it cannot read, so any other result is a failure.
 */
const confirmUnbornHead = (runner: GitCommandRunner, workingDirectory: string) =>
  Effect.gen(function* () {
    const head = yield* runGitAllowFailure(runner, workingDirectory, [
      "rev-parse",
      "--verify",
      "--quiet",
      "HEAD",
    ]);
    if (head.ok) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "expectedBranch",
          message: "The branch changed while History loaded. Refresh to load it again.",
        }),
      );
    }
    const branch = yield* runGitAllowFailure(runner, workingDirectory, [
      "symbolic-ref",
      "--quiet",
      "HEAD",
    ]);
    const branchRef = branch.stdout.trim();
    if (!branch.ok || !branchRef) {
      return yield* Effect.fail(
        unreadableHead(
          combineOptionalOutput(branch.stdout, branch.stderr) ||
            "HEAD names no branch and no commit.",
        ),
      );
    }
    const refs = yield* runGitAllowFailure(runner, workingDirectory, [
      "for-each-ref",
      "--format=%(refname)",
      branchRef,
    ]);
    const exists = splitLines(refs.stdout).includes(branchRef);
    if (!refs.ok || exists || refs.stderr.trim()) {
      return yield* Effect.fail(
        unreadableHead(
          combineOptionalOutput(refs.stdout, refs.stderr) ||
            `${branchRef} exists, but Git cannot read it.`,
        ),
      );
    }
  });

const readBoundary = (
  runner: GitCommandRunner,
  workingDirectory: string,
  currentTip: string,
  targetTip: string,
) =>
  Effect.gen(function* () {
    const result = yield* runGitAllowFailure(runner, workingDirectory, [
      "merge-base",
      "--all",
      "--end-of-options",
      currentTip,
      targetTip,
    ]);
    if (result.ok) return splitLines(result.stdout);
    // Exit 1 without output means that the commits share no ancestor.
    if (result.exitCode === 1 && !result.stdout.trim() && !result.stderr.trim()) return [];
    return yield* Effect.fail(
      new HostOperationError({
        operation: "git.merge-base",
        message: `git merge-base failed: ${combineOutput(result.stdout, result.stderr)}`,
      }),
    );
  });

const readSides = (
  runner: GitCommandRunner,
  workingDirectory: string,
  currentTip: string,
  targetTip: string,
) =>
  Effect.gen(function* () {
    const output = yield* runGit(runner, workingDirectory, [
      "rev-list",
      "--left-right",
      "--end-of-options",
      `${currentTip}...${targetTip}`,
    ]);
    const sides = new Map<string, "current" | "target">();
    for (const line of splitLines(output)) {
      sides.set(line.slice(1), line.startsWith("<") ? "current" : "target");
    }
    return sides;
  });

/**
 * The branches and tags of each commit. An annotated tag points at its tag object, so it uses the
 * commit that the tag peels to. Symbolic refs such as `origin/HEAD` repeat a branch and stay out.
 */
const readRefs = (runner: GitCommandRunner, workingDirectory: string) =>
  Effect.gen(function* () {
    const output = yield* runGit(runner, workingDirectory, [
      "for-each-ref",
      `--format=${REF_FORMAT}`,
      "refs/heads",
      "refs/remotes",
      "refs/tags",
    ]);
    const refsByCommit = new Map<string, GitHistoryRef[]>();
    for (const line of splitLines(output)) {
      const [object = "", peeled = "", refname = "", head = "", symref = ""] = line.split(FIELD);
      const kind = REF_KINDS.find(([prefix]) => refname.startsWith(prefix));
      if (!kind || symref) continue;
      const commit = peeled || object;
      const refs = refsByCommit.get(commit) ?? [];
      refs.push({ name: refname.slice(kind[0].length), kind: kind[1], isHead: head === "*" });
      refsByCommit.set(commit, refs);
    }
    for (const refs of refsByCommit.values()) {
      refs.sort(
        (left, right) =>
          Number(right.isHead) - Number(left.isHead) ||
          REF_ORDER[left.kind] - REF_ORDER[right.kind] ||
          left.name.localeCompare(right.name),
      );
    }
    return refsByCommit;
  });

const parseLog = (
  output: string,
  boundary: ReadonlySet<string>,
  sides: ReadonlyMap<string, "current" | "target">,
  refsByCommit: ReadonlyMap<string, GitHistoryRef[]>,
) =>
  Effect.gen(function* () {
    const commits: GitHistoryCommit[] = [];
    for (const record of output.split(RECORD)) {
      const trimmed = record.replace(/^\r?\n/u, "");
      if (!trimmed) continue;
      const [
        oid = "",
        parents = "",
        authorName = "",
        authorEmail = "",
        authorDate = "",
        subject = "",
        ...body
      ] = trimmed.split(FIELD);
      const membership = boundary.has(oid) ? "boundary" : sides.get(oid);
      if (!membership) {
        return yield* Effect.fail(
          new HostOperationError({
            operation: "git.log",
            message: `Git listed commit ${oid} outside the branch comparison.`,
          }),
        );
      }
      const parentOids = parents.split(" ").filter(Boolean);
      commits.push({
        oid,
        parentOids,
        outsideParentOids: parentOids.filter(
          (parent) => !boundary.has(parent) && !sides.has(parent),
        ),
        membership,
        subject,
        message: body.join(FIELD).trimEnd(),
        authorName,
        authorEmail,
        authorDate,
        refs: refsByCommit.get(oid) ?? [],
      });
    }
    return commits;
  });

/**
 * Lists commits unique to either tip, then their best common ancestors, in topological order.
 * Older shared history stays out because the parents of each common ancestor are excluded.
 */
export const readHistoryPage = (
  runner: GitCommandRunner,
  workingDirectory: string,
  input: GitHistoryPageInput,
): Effect.Effect<GitHistoryPage, GitPortError> =>
  Effect.gen(function* () {
    const currentTip = input.currentBranch.revision;
    if (!currentTip) {
      yield* confirmUnbornHead(runner, workingDirectory);
      return { outcome: "no_commits" };
    }
    const targetTip = yield* resolveTargetTip(runner, workingDirectory, input.targetReference);
    const page = input.page;
    if (page && (page.currentTip !== currentTip || page.targetTip !== targetTip)) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "page",
          message: "The branches changed while History loaded. Refresh to load it again.",
        }),
      );
    }
    const boundaryOids = yield* readBoundary(runner, workingDirectory, currentTip, targetTip);
    if (boundaryOids.length === 0) {
      const shallow = yield* runGit(runner, workingDirectory, [
        "rev-parse",
        "--is-shallow-repository",
      ]);
      return {
        outcome: "no_common_ancestor",
        currentTip,
        targetTip,
        shallow: shallow.trim() === "true",
      };
    }
    const excludedParents = splitLines(
      // Merge base output holds only object IDs, so no argument can read as an option.
      yield* runGit(runner, workingDirectory, [
        "rev-parse",
        ...boundaryOids.map((oid) => `${oid}^@`),
      ]),
    );
    const offset = page?.offset ?? 0;
    const [sides, refsByCommit, output] = yield* Effect.all(
      [
        readSides(runner, workingDirectory, currentTip, targetTip),
        readRefs(runner, workingDirectory),
        runGit(runner, workingDirectory, [
          "log",
          "--topo-order",
          "--no-show-signature",
          `--format=${LOG_FORMAT}`,
          `--skip=${offset}`,
          `--max-count=${GIT_HISTORY_PAGE_SIZE + 1}`,
          "--end-of-options",
          currentTip,
          targetTip,
          ...excludedParents.map((oid) => `^${oid}`),
          "--",
        ]),
      ],
      { concurrency: "unbounded" },
    );
    const commits = yield* parseLog(output, new Set(boundaryOids), sides, refsByCommit);
    let ahead = 0;
    for (const side of sides.values()) if (side === "current") ahead += 1;
    return {
      outcome: "page",
      comparison: {
        currentTip,
        targetTip,
        boundaryOids,
        aheadBehind: { ahead, behind: sides.size - ahead },
      },
      commits: commits.slice(0, GIT_HISTORY_PAGE_SIZE),
      nextOffset: commits.length > GIT_HISTORY_PAGE_SIZE ? offset + GIT_HISTORY_PAGE_SIZE : null,
    };
  });
