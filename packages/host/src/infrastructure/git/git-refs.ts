import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { OwnedTrackingRef } from "../../ports/git-port";
import {
  combineOutput,
  type GitCommandRunner,
  referenceExists,
  runGit,
  runGitAllowFailure,
} from "./git-command-runner";

/**
 * Creates a ref only when it does not exist (`update-ref` with an empty old value), so it never
 * replaces a ref that a fetch wrote. Returns true when it created the ref, and false when the ref
 * exists.
 */
export const createRefIfMissing = (
  runner: GitCommandRunner,
  workingDirectory: string,
  ref: string,
  oid: string,
) =>
  Effect.gen(function* () {
    const created = yield* runGitAllowFailure(runner, workingDirectory, [
      "update-ref",
      ref,
      oid,
      "",
    ]);
    if (created.ok) return true;
    if (yield* referenceExists(runner, workingDirectory, ref)) return false;
    return yield* new HostOperationError({
      message: `Git could not create ${ref}: ${combineOutput(created.stdout, created.stderr)}`,
      operation: "git.update-ref.create",
    });
  });

/** The commit of a ref, or null when it does not exist. */
export const readRefOid = (runner: GitCommandRunner, workingDirectory: string, ref: string) =>
  runGitAllowFailure(runner, workingDirectory, ["rev-parse", "--verify", "--quiet", ref]).pipe(
    Effect.map((result) => (result.ok ? result.stdout.trim() || null : null)),
  );

/** The branch ref that a worktree has checked out, or an empty string for a detached HEAD. */
export const readHeadRef = (runner: GitCommandRunner, workingDirectory: string) =>
  runGitAllowFailure(runner, workingDirectory, ["symbolic-ref", "--quiet", "HEAD"]).pipe(
    Effect.map((result) => (result.ok ? result.stdout.trim() : "")),
  );

/**
 * Deletes a ref that OpenDucktor created, only while it still holds the commit that OpenDucktor
 * wrote (`update-ref -d <ref> <oid>`). A missing ref, or a value that a fetch wrote, stays.
 */
export const deleteOwnedReference = (
  runner: GitCommandRunner,
  repoPath: string,
  owned: OwnedTrackingRef,
) =>
  Effect.gen(function* () {
    const deleted = yield* runGitAllowFailure(runner, repoPath, [
      "update-ref",
      "-d",
      owned.ref,
      owned.oid,
    ]);
    if (deleted.ok) return;
    if ((yield* readRefOid(runner, repoPath, owned.ref)) !== owned.oid) return;
    return yield* new HostOperationError({
      message: `Git could not delete ${owned.ref}: ${combineOutput(deleted.stdout, deleted.stderr)}`,
      operation: "git.update-ref.delete",
    });
  });

/** The upstream of the branch that a worktree has checked out, such as `origin/feat/report`. */
export const readUpstream = (runner: GitCommandRunner, workingDirectory: string) =>
  runGit(runner, workingDirectory, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ]).pipe(Effect.map((output) => output.trim()));
