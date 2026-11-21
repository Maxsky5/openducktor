import { Effect } from "effect";
import { errorMessage, HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { OwnedTrackingRef } from "../../ports/git-port";
import {
  combineOutput,
  type GitCommandError,
  type GitCommandRunner,
  requireNonEmptyEffect,
  runGit,
  runGitAllowFailure,
} from "./git-command-runner";
import { createRefIfMissing, deleteOwnedReference, readRefOid, readUpstream } from "./git-refs";

/**
 * Makes `branch` track the branch of the same name on `upstreamRemote`. When the tracking ref does
 * not exist, the setup creates it at the branch commit and returns it, with that commit, as owned. Each failure undoes
 * the settings and the owned ref that the setup wrote, so the caller owns nothing on failure.
 *
 * `requireNewTrackingRef` is for a branch name that the host chose as free. The setup creates the
 * tracking ref before any upstream setting names it, so a remote branch that a fetch brought since
 * the name was chosen fails the setup instead of becoming the upstream.
 */
export const configureBranchUpstream = (
  runner: GitCommandRunner,
  repoPath: string,
  worktreePath: string,
  branch: string,
  upstreamRemote: string,
  requireNewTrackingRef: boolean,
): Effect.Effect<OwnedTrackingRef | null, GitCommandError> =>
  Effect.gen(function* () {
    const targetBranch = yield* requireNonEmptyEffect(branch, "branch");
    const remote = yield* requireNonEmptyEffect(upstreamRemote, "upstream remote");
    const localBranchRef = `refs/heads/${targetBranch}`;
    const trackingRef = `refs/remotes/${remote}/${targetBranch}`;
    const expectedUpstream = `${remote}/${targetBranch}`;

    const oid = yield* readRefOid(runner, repoPath, localBranchRef);
    if (oid === null)
      return yield* new HostValidationError({
        message: `Branch ${targetBranch} does not exist, so OpenDucktor cannot set its upstream.`,
        field: "branch",
      });
    // Create-only and before any upstream setting names the ref, so a ref that a fetch wrote stays
    // and is not owned.
    const owned: OwnedTrackingRef | null = (yield* createRefIfMissing(
      runner,
      repoPath,
      trackingRef,
      oid,
    ))
      ? { ref: trackingRef, oid }
      : null;
    if (requireNewTrackingRef && owned === null)
      return yield* new HostValidationError({
        message: `The remote branch ${expectedUpstream} appeared after OpenDucktor chose the branch name ${targetBranch}. Start the session again to choose another name.`,
        field: "branchName",
      });

    const writtenKeys: string[] = [];
    const undo = Effect.gen(function* () {
      const problems: string[] = [];
      if (owned !== null) {
        const deleted = yield* Effect.result(deleteOwnedReference(runner, repoPath, owned));
        if (deleted._tag === "Failure")
          problems.push(
            `Also failed to delete created upstream tracking ref ${owned.ref}: ${deleted.failure.message}`,
          );
      }
      for (const key of writtenKeys) {
        const unset = yield* runGitAllowFailure(runner, repoPath, ["config", "--unset-all", key]);
        if (!unset.ok)
          problems.push(
            `Also failed to unset git config ${key}: ${combineOutput(unset.stdout, unset.stderr)}`,
          );
      }
      return problems.map((problem) => `\n${problem}`).join("");
    });
    const step = <A, E>(effect: Effect.Effect<A, E>, message: string, operation: string) =>
      effect.pipe(
        Effect.catch((cause) =>
          Effect.gen(function* () {
            const problems = yield* undo;
            return yield* new HostOperationError({
              message: `${message}: ${errorMessage(cause)}${problems}`,
              operation,
              cause,
            });
          }),
        ),
      );
    const writeConfig = (key: string, value: string, operation: string) =>
      step(
        runGit(runner, repoPath, ["config", key, value]).pipe(
          Effect.tap(() => Effect.sync(() => writtenKeys.push(key))),
        ),
        `Failed configuring upstream ${expectedUpstream} for branch ${targetBranch}`,
        operation,
      );

    yield* writeConfig(`branch.${targetBranch}.remote`, remote, "git.config.upstream-remote");
    yield* writeConfig(`branch.${targetBranch}.merge`, localBranchRef, "git.config.upstream-merge");
    const resolvedUpstream = yield* step(
      readUpstream(runner, worktreePath),
      `Failed verifying upstream tracking for branch ${targetBranch}`,
      "git.verify-upstream-tracking",
    );
    if (resolvedUpstream !== expectedUpstream) {
      const problems = yield* undo;
      return yield* new HostValidationError({
        message: `configured upstream resolved to ${resolvedUpstream}, expected ${expectedUpstream}${problems}`,
        field: "upstream",
      });
    }
    return owned;
  });
