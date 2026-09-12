import { Effect } from "effect";
import type { HostValidationErrorAggregate } from "../../effect/host-errors";
import type { TaskServiceWithMutationProgress } from "./task-service";

export type WorkspaceAdmission = {
  withWorkStartLease<A, E, R>(
    repoPath: string,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | HostValidationErrorAggregate, R>;
};

export const withWorkspaceAdmission = (
  service: TaskServiceWithMutationProgress,
  admission: WorkspaceAdmission,
): TaskServiceWithMutationProgress => {
  const guard = <A, E, R>(
    repoPath: string,
    operation: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | HostValidationErrorAggregate, R> =>
    admission.withWorkStartLease(repoPath, operation);

  return {
    ...service,
    agentSessionDelete: (input) => guard(input.repoPath, service.agentSessionDelete(input)),
    agentSessionUpdateModel: (input) =>
      guard(input.repoPath, service.agentSessionUpdateModel(input)),
    agentSessionUpsert: (input) => guard(input.repoPath, service.agentSessionUpsert(input)),
    buildBlocked: (input) => guard(input.repoPath, service.buildBlocked(input)),
    buildCompleted: (input) => guard(input.repoPath, service.buildCompleted(input)),
    buildResumed: (input) => guard(input.repoPath, service.buildResumed(input)),
    buildStart: (input) => guard(input.repoPath, service.buildStart(input)),
    closeTask: (input) => guard(input.repoPath, service.closeTask(input)),
    completeDirectMerge: (input) => guard(input.repoPath, service.completeDirectMerge(input)),
    createTask: (input) => guard(input.repoPath, service.createTask(input)),
    deleteTask: (input) => guard(input.repoPath, service.deleteTask(input)),
    detectPullRequest: (input) => guard(input.repoPath, service.detectPullRequest(input)),
    directMerge: (input) => guard(input.repoPath, service.directMerge(input)),
    humanApprove: (input) => guard(input.repoPath, service.humanApprove(input)),
    humanRequestChanges: (input) => guard(input.repoPath, service.humanRequestChanges(input)),
    linkMergedPullRequest: (input) => guard(input.repoPath, service.linkMergedPullRequest(input)),
    linkPullRequest: (input) => guard(input.repoPath, service.linkPullRequest(input)),
    qaApproved: (input) => guard(input.repoPath, service.qaApproved(input)),
    qaRejected: (input) => guard(input.repoPath, service.qaRejected(input)),
    repoPullRequestSync: (input) => guard(input.repoPath, service.repoPullRequestSync(input)),
    repoPullRequestSyncDetailed: (input) =>
      guard(input.repoPath, service.repoPullRequestSyncDetailed(input)),
    resetImplementation: (input) => guard(input.repoPath, service.resetImplementation(input)),
    resetTask: (input) => guard(input.repoPath, service.resetTask(input)),
    savePlanDocument: (input) => guard(input.repoPath, service.savePlanDocument(input)),
    saveSpecDocument: (input) => guard(input.repoPath, service.saveSpecDocument(input)),
    setPlan: (input) => guard(input.repoPath, service.setPlan(input)),
    setSpec: (input) => guard(input.repoPath, service.setSpec(input)),
    transitionTask: (input) => guard(input.repoPath, service.transitionTask(input)),
    unlinkPullRequest: (input) => guard(input.repoPath, service.unlinkPullRequest(input)),
    updateTask: (input) => guard(input.repoPath, service.updateTask(input)),
    upsertPullRequest: (input) => guard(input.repoPath, service.upsertPullRequest(input)),
  };
};
