import {
  type GitChangeGroup,
  type GitCurrentBranch,
  type GitReadContext,
  type GitResetSnapshot,
  gitChangeSelectionResultSchema,
  gitCommitAllResultSchema,
  gitHistoryPageSchema,
  gitLocalChangesSchema,
} from "@openducktor/contracts";
import { Clock, Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { GitHistoryPageInput, GitPort } from "../../ports/git-port";
import { resolveGitWorkingDirectory } from "./git-service-inputs";
import type { GitService } from "./git-service-types";
import {
  createWorktreeSnapshot,
  hashLocalGroupSnapshot,
  hashWorktreeDiffPayload,
  hashWorktreeStatusPayload,
  validateLocalSnapshotsMatch,
} from "./git-worktree-snapshot";

const sameCheckout = (expected: GitCurrentBranch, actual: GitCurrentBranch): boolean =>
  expected.name === actual.name &&
  expected.detached === actual.detached &&
  expected.revision === actual.revision;

const checkoutChangedError = () =>
  new HostValidationError({
    field: "expectedBranch",
    message: "The branch or its latest commit changed. Refresh and review the changes.",
  });

const toValidationError = (cause: unknown) =>
  cause instanceof HostValidationError
    ? cause
    : new HostValidationError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      });

/** Writes fail before they change content when the checkout moved after the user reviewed it. */
export const requireCheckout = (
  gitPort: GitPort,
  workingDirectory: string,
  expected: GitCurrentBranch,
) =>
  Effect.gen(function* () {
    const actual = yield* gitPort.getCurrentBranch(workingDirectory);
    if (!sameCheckout(expected, actual)) return yield* Effect.fail(checkoutChangedError());
    return actual;
  });

const branchChangedError = () =>
  new HostValidationError({
    field: "expectedBranch",
    message: "The branch changed. Refresh to read its History.",
  });

/**
 * A read of the branch that the panel shows. A commit after the panel read the branch keeps the
 * same branch, so the read uses the newest commit. Another branch, or a detached HEAD instead of
 * a branch, fails the read. Writes use `requireCheckout`, which also checks the commit.
 */
const requireBranch = (gitPort: GitPort, workingDirectory: string, expected: GitCurrentBranch) =>
  Effect.gen(function* () {
    const actual = yield* gitPort.getCurrentBranch(workingDirectory);
    if (expected.detached !== actual.detached || expected.name !== actual.name) {
      return yield* Effect.fail(branchChangedError());
    }
    return actual;
  });

/** Reads both groups of a working directory with the snapshots that check a later change. */
const readLocalChanges = (
  gitPort: GitPort,
  workingDirectory: string,
  readContext?: GitReadContext,
) =>
  Effect.gen(function* () {
    const changes = yield* gitPort.getLocalChanges(workingDirectory, readContext);
    const observedAtMs = yield* Clock.currentTimeMillis;
    const snapshot = createWorktreeSnapshot(
      workingDirectory,
      "HEAD",
      "uncommitted",
      // The HEAD summary read uses the same status hash, so its refresh check still applies.
      hashWorktreeStatusPayload(
        changes.currentBranch,
        changes.fileStatuses,
        { ahead: 0, behind: 0 },
        changes.upstreamAheadBehind,
      ),
      hashWorktreeDiffPayload([
        ...changes.unstaged.fileDiffs,
        ...changes.staged.fileDiffs,
        ...changes.conflicted.fileDiffs,
      ]),
      observedAtMs,
    );
    return yield* Effect.try({
      try: () =>
        gitLocalChangesSchema.parse({
          ...changes,
          unstaged: {
            ...changes.unstaged,
            snapshot: hashLocalGroupSnapshot(changes.currentBranch, changes.unstaged),
          },
          staged: {
            ...changes.staged,
            snapshot: hashLocalGroupSnapshot(changes.currentBranch, changes.staged),
          },
          gitConflict: changes.gitConflict
            ? { ...changes.gitConflict, workingDir: workingDirectory }
            : undefined,
          snapshot,
        }),
      catch: toValidationError,
    });
  });

/**
 * Reads the local changes before a write and proves that the user reviewed them: the checkout is
 * the expected one, and each reviewed group still has the snapshot that the panel showed.
 */
const readReviewedChanges = (
  gitPort: GitPort,
  input: { repoPath: string; workingDir?: string | undefined; expectedBranch: GitCurrentBranch },
  reviewed: { group: GitChangeGroup; snapshot: GitResetSnapshot }[],
) =>
  Effect.gen(function* () {
    const workingDirectory = yield* resolveGitWorkingDirectory(
      gitPort,
      input.repoPath,
      input.workingDir,
    );
    const changes = yield* gitPort.getLocalChanges(workingDirectory);
    if (!sameCheckout(input.expectedBranch, changes.currentBranch)) {
      return yield* Effect.fail(checkoutChangedError());
    }
    yield* Effect.try({
      try: () =>
        validateLocalSnapshotsMatch(
          reviewed.map(({ snapshot }) => snapshot),
          reviewed.map(({ group }) =>
            hashLocalGroupSnapshot(changes.currentBranch, changes[group]),
          ),
        ),
      catch: toValidationError,
    });
    return { workingDirectory, changes };
  });

/** Staged and unstaged groups, their writes, the staged commit, and branch History. */
export const createGitLocalChangeMethods = (
  gitPort: GitPort,
): Pick<GitService, "getLocalChanges" | "changeSelection" | "commitStaged" | "getHistoryPage"> => ({
  getLocalChanges(input) {
    return Effect.gen(function* () {
      const workingDirectory = yield* resolveGitWorkingDirectory(
        gitPort,
        input.repoPath,
        input.workingDir,
        input.readContext,
      );
      return yield* readLocalChanges(gitPort, workingDirectory, input.readContext);
    });
  },
  changeSelection(input) {
    return Effect.gen(function* () {
      const { workingDirectory, changes } = yield* readReviewedChanges(gitPort, input, [
        { group: "unstaged", snapshot: input.snapshots.unstaged },
        { group: "staged", snapshot: input.snapshots.staged },
      ]);
      const result = yield* gitPort.changeSelection(workingDirectory, changes, {
        action: input.action,
        group: input.group,
        selection: input.selection,
      });
      // The panel shows this read at once, and its snapshots check the next change.
      const localChanges = yield* readLocalChanges(gitPort, workingDirectory);
      return yield* Effect.try({
        try: () => gitChangeSelectionResultSchema.parse({ ...result, localChanges }),
        catch: toValidationError,
      });
    });
  },
  commitStaged(input) {
    return Effect.gen(function* () {
      // A commit must not record staged content that the user did not review.
      const { workingDirectory } = yield* readReviewedChanges(gitPort, input, [
        { group: "staged", snapshot: input.stagedSnapshot },
      ]);
      const result = yield* gitPort.commitStaged(workingDirectory, input.message);
      return yield* Effect.try({
        try: () => gitCommitAllResultSchema.parse(result),
        catch: toValidationError,
      });
    });
  },
  getHistoryPage(input) {
    return Effect.gen(function* () {
      const workingDirectory = yield* resolveGitWorkingDirectory(
        gitPort,
        input.repoPath,
        input.workingDir,
      );
      const currentBranch = yield* requireBranch(gitPort, workingDirectory, input.expectedBranch);
      const pageInput: GitHistoryPageInput = {
        currentBranch,
        targetReference: input.targetReference,
      };
      if (input.page) pageInput.page = input.page;
      const page = yield* gitPort.getHistoryPage(workingDirectory, pageInput);
      return yield* Effect.try({
        try: () => gitHistoryPageSchema.parse(page),
        catch: toValidationError,
      });
    });
  },
});
