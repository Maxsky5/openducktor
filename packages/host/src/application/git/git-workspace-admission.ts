import { Effect } from "effect";
import type { HostValidationErrorAggregate } from "../../effect/host-errors";
import type { WorkspaceOwnershipLock } from "../workspaces/workspace-ownership-lock";
import type { GitService } from "./git-service-types";

export type GitWorkspaceAdmission = {
  assertWorkspaceAdmitsWork(repoPath: string): Effect.Effect<void, HostValidationErrorAggregate>;
  withWorkStartLease<A, E, R>(
    repoPath: string,
    effect: Effect.Effect<A, E, R>,
    workingDirectory?: string,
  ): Effect.Effect<A, E | HostValidationErrorAggregate, R>;
};

export const withGitWorkspaceAdmission = (
  service: GitService,
  admission: GitWorkspaceAdmission,
  ownershipLock: WorkspaceOwnershipLock,
): GitService => {
  const guard = <A, E, R>(
    repoPath: string,
    operation: Effect.Effect<A, E, R>,
    workingDirectory = repoPath,
  ): Effect.Effect<A, E | HostValidationErrorAggregate, R> =>
    admission.withWorkStartLease(
      repoPath,
      admission.assertWorkspaceAdmitsWork(repoPath).pipe(Effect.zipRight(operation)),
      workingDirectory,
    );

  return {
    ...service,
    abortConflict: (input) => guard(input.repoPath, service.abortConflict(input), input.workingDir),
    commitAll: (input) => guard(input.repoPath, service.commitAll(input), input.workingDir),
    createWorktree: (input) => guard(input.repoPath, service.createWorktree(input)),
    fetchRemote: (input) => guard(input.repoPath, service.fetchRemote(input), input.workingDir),
    pullBranch: (input) => guard(input.repoPath, service.pullBranch(input), input.workingDir),
    pushBranch: (input) => guard(input.repoPath, service.pushBranch(input), input.workingDir),
    rebaseAbort: (input) => guard(input.repoPath, service.rebaseAbort(input), input.workingDir),
    rebaseBranch: (input) => guard(input.repoPath, service.rebaseBranch(input), input.workingDir),
    removeWorktree: (input) =>
      ownershipLock.runExclusive(
        guard(input.repoPath, service.removeWorktree(input), input.worktreePath),
      ),
    resetWorktreeSelection: (input) =>
      guard(input.repoPath, service.resetWorktreeSelection(input), input.workingDir),
    switchBranch: (input) => guard(input.repoPath, service.switchBranch(input)),
  };
};
