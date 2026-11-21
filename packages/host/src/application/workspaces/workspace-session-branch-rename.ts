import {
  automaticWorktreeName,
  hasAutomaticWorktreeBranch,
  type WorkspaceSession,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { cleanTaskBranchPrefix } from "../../domain/task/task-branch-policy";
import {
  type HostError,
  HostOperationError,
  HostValidationError,
  errorMessage,
} from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { NamedBranch } from "../naming/branch-naming";

/** The temporary branch of an unnamed chat worktree. */
export const temporaryWorkspaceBranch = (branchPrefix: string, sessionId: string): string =>
  `${cleanTaskBranchPrefix(branchPrefix)}/${automaticWorktreeName(sessionId)}`;

export type FinalizedBranch = {
  branch: string;
  /** The model title, or null when the model gave none. */
  title: string | null;
  /** Why the branch is not the model branch, for the session, or null. */
  notice: string | null;
};

/**
 * Renames the temporary branch of an unnamed chat worktree to the named branch, and makes it track
 * the branch of the same name on `upstreamRemote`. Git renames the checked-out branch only when
 * the worktree still has the temporary branch, and it never replaces an existing branch. The
 * upstream setup fails when a remote branch of the name appeared since naming; the branch then
 * gets its temporary name back. When Git cannot take a model branch, the free fallback follows.
 */
export const renameTemporaryBranch = (
  git: Pick<GitPort, "renameCheckedOutBranch" | "configureBranchUpstream">,
  input: {
    named: NamedBranch;
    workingDirectory: string;
    temporaryBranch: string;
    /** The remote of the chat target branch, or null for a local target. */
    upstreamRemote: string | null;
  },
): Effect.Effect<FinalizedBranch, HostError> =>
  Effect.gen(function* () {
    const { named, workingDirectory, temporaryBranch, upstreamRemote } = input;
    const rename = (branch: string) =>
      Effect.gen(function* () {
        yield* git.renameCheckedOutBranch(workingDirectory, temporaryBranch, branch);
        if (upstreamRemote === null) return branch;
        const tracked = yield* Effect.result(
          git.configureBranchUpstream(
            workingDirectory,
            workingDirectory,
            branch,
            upstreamRemote,
            true,
          ),
        );
        if (tracked._tag === "Success") return branch;
        yield* git.renameCheckedOutBranch(workingDirectory, branch, temporaryBranch).pipe(
          Effect.mapError(
            (restoreFailure) =>
              new HostOperationError({
                operation: "git.branch.rename",
                message: `Git renamed the branch ${temporaryBranch} to ${branch}, but could not set its upstream ${upstreamRemote}/${branch}: ${errorMessage(tracked.failure)} Git also could not restore ${temporaryBranch}: ${errorMessage(restoreFailure)} Rename the branch back with git branch -m ${branch} ${temporaryBranch}, or set its upstream with git branch --set-upstream-to, then send the message again.`,
                cause: { trackFailure: tracked.failure, restoreFailure },
              }),
          ),
        );
        return yield* tracked.failure;
      });
    const renamed = yield* Effect.result(rename(named.branch));
    if (renamed._tag === "Success")
      return { branch: renamed.success, title: named.title, notice: named.notice };
    const fallback = named.fallback;
    if (!named.generated || fallback === null) return yield* renamed.failure;
    // The model branch leaves the temporary branch in place, or the error says why it could not.
    const branch = yield* rename(fallback).pipe(
      Effect.mapError(
        (fallbackFailure) =>
          new HostOperationError({
            operation: "workspaceSession.branch.rename",
            message: `Git could not rename the branch of this chat to ${named.branch}: ${errorMessage(renamed.failure)} The branch ${fallback} also failed: ${errorMessage(fallbackFailure)}`,
            cause: { modelFailure: renamed.failure, fallbackFailure },
          }),
      ),
    );
    return {
      branch,
      title: named.title,
      notice: `Git could not rename the branch of this chat to ${named.branch}, so OpenDucktor used ${branch}. ${errorMessage(renamed.failure)} Rename the branch in Git if you want another name.`,
    };
  });

/**
 * Stops the first message of a chat with no creation facts, for example after a restart, when the
 * chat is an unnamed chat worktree before its first message. OpenDucktor cannot prove that it
 * created that branch, so it does not rename it, and the agent must not start on it.
 */
export const requireConfirmedAutomaticBranch = (
  session: Pick<WorkspaceSession, "id" | "executionTarget" | "lastActivityAt">,
) => {
  const target = session.executionTarget;
  if (!hasAutomaticWorktreeBranch(session) || target.kind !== "local_worktree") return Effect.void;
  const branch = target.branchName;
  return Effect.fail(
    new HostValidationError({
      field: "branchName",
      message: `OpenDucktor cannot confirm that it created branch ${branch} for this chat, because the host restarted before the first message. Your message is kept. Rename the branch in Git, for example git branch -m ${branch} <name>, then start a new chat on Existing worktree with ${target.workingDirectory}.`,
    }),
  );
};
