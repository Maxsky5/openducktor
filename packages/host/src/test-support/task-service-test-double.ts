import { Effect } from "effect";
import type {
  TaskService,
  TaskServiceWithMutationProgress,
} from "../application/tasks/task-service";

const unexpectedTaskServiceCall = (methodName: keyof TaskService) => () =>
  Effect.die(new Error(`Unexpected task service call: ${methodName}`));

const createTaskServiceDefaults = () =>
  ({
    listTaskArtifacts: unexpectedTaskServiceCall("listTaskArtifacts"),
    readTaskArtifact: unexpectedTaskServiceCall("readTaskArtifact"),
    createTaskArtifact: unexpectedTaskServiceCall("createTaskArtifact"),
    renameTaskArtifact: unexpectedTaskServiceCall("renameTaskArtifact"),
    replaceTaskArtifact: unexpectedTaskServiceCall("replaceTaskArtifact"),
    deleteTaskArtifact: unexpectedTaskServiceCall("deleteTaskArtifact"),
    agentSessionDelete: unexpectedTaskServiceCall("agentSessionDelete"),
    agentSessionUpdateModel: unexpectedTaskServiceCall("agentSessionUpdateModel"),
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
    findTask: unexpectedTaskServiceCall("findTask"),
    listTaskReferences: unexpectedTaskServiceCall("listTaskReferences"),
    getTaskMetadata: unexpectedTaskServiceCall("getTaskMetadata"),
    getTaskStopImpact: unexpectedTaskServiceCall("getTaskStopImpact"),
    humanApprove: unexpectedTaskServiceCall("humanApprove"),
    humanRequestChanges: unexpectedTaskServiceCall("humanRequestChanges"),
    linkMergedPullRequest: unexpectedTaskServiceCall("linkMergedPullRequest"),
    linkPullRequest: unexpectedTaskServiceCall("linkPullRequest"),
    listTasks: unexpectedTaskServiceCall("listTasks"),
    listKanbanTasks: unexpectedTaskServiceCall("listKanbanTasks"),
    listTaskIds: unexpectedTaskServiceCall("listTaskIds"),
    repoPullRequestSync: unexpectedTaskServiceCall("repoPullRequestSync"),
    repoPullRequestSyncDetailed: unexpectedTaskServiceCall("repoPullRequestSyncDetailed"),
    resetImplementation: unexpectedTaskServiceCall("resetImplementation"),
    resetTask: unexpectedTaskServiceCall("resetTask"),
    transitionTask: unexpectedTaskServiceCall("transitionTask"),
    applyTaskEvent: unexpectedTaskServiceCall("applyTaskEvent"),
    applyStartEvent: unexpectedTaskServiceCall("applyStartEvent"),
    unlinkPullRequest: unexpectedTaskServiceCall("unlinkPullRequest"),
    updateTask: unexpectedTaskServiceCall("updateTask"),
    workflowArtifactGet: unexpectedTaskServiceCall("workflowArtifactGet"),
    workflowArtifactSave: unexpectedTaskServiceCall("workflowArtifactSave"),
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
