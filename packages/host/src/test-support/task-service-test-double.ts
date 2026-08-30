import { Effect } from "effect";
import type {
  TaskService,
  TaskServiceWithMutationProgress,
} from "../application/tasks/task-service";

const unexpectedTaskServiceCall = (methodName: keyof TaskService) => () =>
  Effect.dieMessage(`Unexpected task service call: ${methodName}`);

const createTaskServiceDefaults = () =>
  ({
    agentSessionDelete: unexpectedTaskServiceCall("agentSessionDelete"),
    agentSessionUpsert: unexpectedTaskServiceCall("agentSessionUpsert"),
    agentSessionsList: unexpectedTaskServiceCall("agentSessionsList"),
    agentSessionsListForTasks: unexpectedTaskServiceCall("agentSessionsListForTasks"),
    buildBlocked: unexpectedTaskServiceCall("buildBlocked"),
    buildCompleted: unexpectedTaskServiceCall("buildCompleted"),
    buildResumed: unexpectedTaskServiceCall("buildResumed"),
    buildStart: unexpectedTaskServiceCall("buildStart"),
    closeTask: unexpectedTaskServiceCall("closeTask"),
    completeDirectMerge: unexpectedTaskServiceCall("completeDirectMerge"),
    createTask: unexpectedTaskServiceCall("createTask"),
    deleteTask: unexpectedTaskServiceCall("deleteTask"),
    detectPullRequest: unexpectedTaskServiceCall("detectPullRequest"),
    directMerge: unexpectedTaskServiceCall("directMerge"),
    getApprovalContext: unexpectedTaskServiceCall("getApprovalContext"),
    getTaskMetadata: unexpectedTaskServiceCall("getTaskMetadata"),
    humanApprove: unexpectedTaskServiceCall("humanApprove"),
    humanRequestChanges: unexpectedTaskServiceCall("humanRequestChanges"),
    linkMergedPullRequest: unexpectedTaskServiceCall("linkMergedPullRequest"),
    linkPullRequest: unexpectedTaskServiceCall("linkPullRequest"),
    listTasks: unexpectedTaskServiceCall("listTasks"),
    planGet: unexpectedTaskServiceCall("planGet"),
    qaApproved: unexpectedTaskServiceCall("qaApproved"),
    qaGetReport: unexpectedTaskServiceCall("qaGetReport"),
    qaRejected: unexpectedTaskServiceCall("qaRejected"),
    repoPullRequestSync: unexpectedTaskServiceCall("repoPullRequestSync"),
    repoPullRequestSyncDetailed: unexpectedTaskServiceCall("repoPullRequestSyncDetailed"),
    resetImplementation: unexpectedTaskServiceCall("resetImplementation"),
    resetTask: unexpectedTaskServiceCall("resetTask"),
    savePlanDocument: unexpectedTaskServiceCall("savePlanDocument"),
    saveSpecDocument: unexpectedTaskServiceCall("saveSpecDocument"),
    setPlan: unexpectedTaskServiceCall("setPlan"),
    setSpec: unexpectedTaskServiceCall("setSpec"),
    specGet: unexpectedTaskServiceCall("specGet"),
    taskSessionBootstrapAbort: unexpectedTaskServiceCall("taskSessionBootstrapAbort"),
    taskSessionBootstrapComplete: unexpectedTaskServiceCall("taskSessionBootstrapComplete"),
    taskSessionBootstrapPrepare: unexpectedTaskServiceCall("taskSessionBootstrapPrepare"),
    taskSessionStartupLeaseAbort: unexpectedTaskServiceCall("taskSessionStartupLeaseAbort"),
    taskSessionStartupLeaseComplete: unexpectedTaskServiceCall("taskSessionStartupLeaseComplete"),
    taskSessionStartupLeasePrepare: unexpectedTaskServiceCall("taskSessionStartupLeasePrepare"),
    transitionTask: unexpectedTaskServiceCall("transitionTask"),
    unlinkPullRequest: unexpectedTaskServiceCall("unlinkPullRequest"),
    updateTask: unexpectedTaskServiceCall("updateTask"),
    upsertPullRequest: unexpectedTaskServiceCall("upsertPullRequest"),
  }) satisfies TaskService & TaskServiceWithMutationProgress;

export const createTaskServiceTestDouble = <Overrides extends Partial<TaskService>>(
  overrides: Overrides,
): TaskService => ({ ...createTaskServiceDefaults(), ...overrides });

export const createTaskServiceWithMutationProgressTestDouble = <
  Overrides extends Partial<TaskServiceWithMutationProgress>,
>(
  overrides: Overrides,
): TaskServiceWithMutationProgress => ({
  ...createTaskServiceDefaults(),
  ...overrides,
});
