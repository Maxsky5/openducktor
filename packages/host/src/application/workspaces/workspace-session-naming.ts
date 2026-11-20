import type { RepoConfig, WorkspaceSession } from "@openducktor/contracts";
import { Effect } from "effect";
import { toBranchSlug } from "../../domain/naming/naming-output";
import {
  type HostError,
  HostOperationError,
  HostValidationError,
  errorMessage,
} from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { WorkspaceSessionStoreRef } from "../../ports/workspace-session-store-port";
import {
  namingFailureNotice,
  type NamingOutcome,
  type NamingService,
} from "../naming/naming-service";
import { cleanTaskBranchPrefix } from "../../domain/task/task-branch-policy";
import { freeBranchName, type TakenBranchNames } from "../naming/free-branch-name";
import type { WorkspaceSettingsService } from "./workspace-settings-model";

/** The hexadecimal digits of the folder and the temporary branch of an unnamed chat worktree. */
const AUTOMATIC_NAME_LENGTH = 8;

/** The folder name of an unnamed chat worktree: the first digits of the session ID. */
export const automaticWorktreeName = (sessionId: string): string =>
  sessionId.replace(/-/g, "").slice(0, AUTOMATIC_NAME_LENGTH).toLowerCase();

/** The temporary branch of an unnamed chat worktree. */
export const temporaryWorkspaceBranch = (branchPrefix: string, sessionId: string): string =>
  `${cleanTaskBranchPrefix(branchPrefix)}/${automaticWorktreeName(sessionId)}`;

/**
 * What this host process knows about a chat that it created, until its first message. `created`
 * holds the temporary branch that this host created because the user left both names blank. It
 * tracks the target branch until the first message sets the upstream of its final name. `renamed` follows a Git rename whose record
 * save did not finish, so the next send saves the final branch without a second rename.
 * `branchNamed` follows the saved final branch. Both hold the title that the branch request gave,
 * or null.
 */
export type CreationFacts =
  | { stage: "created"; temporaryBranch: string | null }
  | ({ stage: "renamed" } & FinalizedBranch)
  | { stage: "branchNamed"; title: string | null };

const factKey = ({
  workspaceId,
  sessionId,
}: Pick<WorkspaceSessionStoreRef, "workspaceId" | "sessionId">) =>
  JSON.stringify([workspaceId, sessionId]);

/**
 * The creation facts of the chats that this host process created. Only a fact authorizes a branch
 * rename, because a branch name gives no proof that OpenDucktor created the branch. A fact is also
 * the evidence that the first message of a chat can name it.
 */
export const createWorkspaceSessionCreationFacts = () => {
  const facts = new Map<string, CreationFacts>();
  return {
    created: (ref: Parameters<typeof factKey>[0], temporaryBranch: string | null) => {
      facts.set(factKey(ref), { stage: "created", temporaryBranch });
    },
    get: (ref: Parameters<typeof factKey>[0]) => facts.get(factKey(ref)),
    branchRenamed: (ref: Parameters<typeof factKey>[0], finalized: FinalizedBranch) => {
      if (facts.has(factKey(ref))) facts.set(factKey(ref), { stage: "renamed", ...finalized });
    },
    branchFinalized: (ref: Parameters<typeof factKey>[0], title: string | null) => {
      if (facts.has(factKey(ref))) facts.set(factKey(ref), { stage: "branchNamed", title });
    },
    /** Retires the facts of a chat at its first accepted message. */
    take: (ref: Parameters<typeof factKey>[0]) => {
      const fact = facts.get(factKey(ref));
      facts.delete(factKey(ref));
      return fact;
    },
  };
};
export type WorkspaceSessionCreationFacts = ReturnType<typeof createWorkspaceSessionCreationFacts>;

export type WorkspaceSessionNamingDependencies = {
  facts: WorkspaceSessionCreationFacts;
  service: NamingService;
  settings: Pick<WorkspaceSettingsService, "getRepoConfig">;
  git: Pick<
    GitPort,
    "listRefNames" | "listRemoteNames" | "renameCheckedOutBranch" | "configureBranchUpstream"
  >;
};

export type FinalizedBranch = {
  branch: string;
  /** The model title, or null when the model gave none. */
  title: string | null;
  /** A naming error that the session shows, or null. A time-out shows none. */
  notice: string | null;
};

/**
 * Renames the temporary branch of an unnamed chat worktree and makes the final branch track the
 * branch of the same name on `upstreamRemote`. The model branch comes first. Without it, the
 * branch comes from the first message. Git renames the checked-out branch only when the worktree
 * still has the temporary branch, and it never replaces an existing branch. The upstream setup
 * fails when a remote branch of the final name appeared since the name was chosen; the branch then
 * gets its temporary name back, so the first-message branch can follow.
 */
export const renameTemporaryBranch = (
  git: WorkspaceSessionNamingDependencies["git"],
  input: {
    repoConfig: Pick<RepoConfig, "branchPrefix">;
    /** The names that the final branch must not take, with the target branch of the chat. */
    taken: TakenBranchNames;
    outcome: NamingOutcome;
    workingDirectory: string;
    temporaryBranch: string;
    /** The remote of the chat target branch, or null for a local target. */
    upstreamRemote: string | null;
    messageText: string;
  },
): Effect.Effect<FinalizedBranch, HostError> =>
  Effect.gen(function* () {
    const { outcome } = input;
    const slug = toBranchSlug(input.messageText) || "session";
    const fallback = `${cleanTaskBranchPrefix(input.repoConfig.branchPrefix)}/${slug}`;
    const rename = (branch: string) =>
      Effect.gen(function* () {
        const free = yield* freeBranchName(input.taken, branch);
        const { workingDirectory, temporaryBranch, upstreamRemote } = input;
        yield* git.renameCheckedOutBranch(workingDirectory, temporaryBranch, free);
        if (upstreamRemote === null) return free;
        const tracked = yield* Effect.result(
          git.configureBranchUpstream(
            workingDirectory,
            workingDirectory,
            free,
            upstreamRemote,
            true,
          ),
        );
        if (tracked._tag === "Success") return free;
        yield* git.renameCheckedOutBranch(workingDirectory, free, temporaryBranch).pipe(
          Effect.mapError(
            (restoreFailure) =>
              new HostOperationError({
                operation: "git.branch.rename",
                message: `Git renamed the branch ${temporaryBranch} to ${free}, but could not set its upstream ${upstreamRemote}/${free}: ${errorMessage(tracked.failure)} Git also could not restore ${temporaryBranch}: ${errorMessage(restoreFailure)} Rename the branch back with git branch -m ${free} ${temporaryBranch}, or set its upstream with git branch --set-upstream-to, then send the message again.`,
                cause: { trackFailure: tracked.failure, restoreFailure },
              }),
          ),
        );
        return yield* tracked.failure;
      });
    if (outcome.kind === "generated" && outcome.branch) {
      const renamed = yield* Effect.result(rename(outcome.branch));
      if (renamed._tag === "Success")
        return { branch: renamed.success, title: outcome.title ?? null, notice: null };
      // The model rename leaves the temporary branch in place or says why it could not.
      const branch = yield* rename(fallback).pipe(
        Effect.mapError(
          (fallbackFailure) =>
            new HostOperationError({
              operation: "workspaceSession.branch.rename",
              message: `Git could not rename the branch of this chat to ${outcome.branch}: ${errorMessage(renamed.failure)} The first-message branch ${fallback} also failed: ${errorMessage(fallbackFailure)}`,
              cause: { modelFailure: renamed.failure, fallbackFailure },
            }),
        ),
      );
      return {
        branch,
        title: null,
        notice: `Git could not rename the branch of this chat to ${outcome.branch}, so OpenDucktor used ${branch}. ${errorMessage(renamed.failure)} Rename the branch in Git if you want another name.`,
      };
    }
    const branch = yield* rename(fallback);
    return {
      branch,
      title: null,
      notice:
        outcome.kind === "failed"
          ? namingFailureNotice(
              outcome.message,
              `the branch ${branch} and the shortened message as the title`,
            )
          : null,
    };
  });

/**
 * Stops the first message of a chat with no creation facts, for example after a restart, when the
 * chat has no accepted message and both its folder and its branch end with the automatic digits of
 * its session ID. OpenDucktor cannot prove that it created that branch, so it does not rename it,
 * and the agent must not start on it. The check ignores the prefix, because the prefix setting can
 * change after creation.
 */
export const requireConfirmedAutomaticBranch = (
  session: Pick<WorkspaceSession, "id" | "executionTarget" | "lastActivityAt">,
) => {
  const target = session.executionTarget;
  const digits = automaticWorktreeName(session.id);
  if (
    target.kind !== "local_worktree" ||
    target.branchName === null ||
    session.lastActivityAt !== undefined ||
    target.workingDirectory.split(/[\\/]/).at(-1) !== digits ||
    target.branchName.split("/").at(-1) !== digits
  )
    return Effect.void;
  const branch = target.branchName;
  return Effect.fail(
    new HostValidationError({
      field: "branchName",
      message: `OpenDucktor cannot confirm that it created branch ${branch} for this chat, because the host restarted before the first message. Your message is kept. Rename the branch in Git, for example git branch -m ${branch} <name>, then start a new chat on Existing worktree with ${target.workingDirectory}.`,
    }),
  );
};
