import { Effect } from "effect";
import type { HostValidationErrorAggregate } from "../../effect/host-errors";
import type { GitService } from "./git-service-types";

export type GitWorkspaceAdmission = {
  assertWorkspaceAdmitsWork(repoPath: string): Effect.Effect<void, HostValidationErrorAggregate>;
  withWorkStartLease<A, E, R>(
    repoPath: string,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | HostValidationErrorAggregate, R>;
};

export const withGitWorkspaceAdmission = (
  service: GitService,
  admission: GitWorkspaceAdmission,
): GitService => {
  const guard = <A, E, R>(
    repoPath: string,
    operation: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | HostValidationErrorAggregate, R> =>
    admission.withWorkStartLease(
      repoPath,
      admission.assertWorkspaceAdmitsWork(repoPath).pipe(Effect.zipRight(operation)),
    );

  return {
    ...service,
    abortConflict: (input) => guard(input.repoPath, service.abortConflict(input)),
    commitAll: (input) => guard(input.repoPath, service.commitAll(input)),
    createWorktree: (input) => guard(input.repoPath, service.createWorktree(input)),
    fetchRemote: (input) => guard(input.repoPath, service.fetchRemote(input)),
    pullBranch: (input) => guard(input.repoPath, service.pullBranch(input)),
    pushBranch: (input) => guard(input.repoPath, service.pushBranch(input)),
    rebaseAbort: (input) => guard(input.repoPath, service.rebaseAbort(input)),
    rebaseBranch: (input) => guard(input.repoPath, service.rebaseBranch(input)),
    removeWorktree: (input) => guard(input.repoPath, service.removeWorktree(input)),
    resetWorktreeSelection: (input) => guard(input.repoPath, service.resetWorktreeSelection(input)),
    switchBranch: (input) => guard(input.repoPath, service.switchBranch(input)),
  };
};
