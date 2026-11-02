import { Effect } from "effect";
import { HostResourceError } from "../effect/host-errors";
import type {
  AtomicTaskTransition,
  TaskRecord,
  TaskStoreError,
  TaskStorePort,
  WorkflowArtifactSaveResult,
  WorkflowArtifactWrite,
} from "../ports/task-repository-ports";

const unexpectedTaskStoreCall = (methodName: keyof TaskStorePort) => () =>
  Effect.die(new Error(`Unexpected task store call: ${methodName}`));

/** A double that lists tasks reads one task from the same list, as the real store does. */
const getTaskFromList =
  (listTasks: TaskStorePort["listTasks"]): TaskStorePort["getTask"] =>
  ({ workspaceId, repoPath, taskId }) =>
    listTasks({ workspaceId, repoPath }).pipe(
      Effect.flatMap((tasks) => {
        const current = tasks.find((task) => task.id === taskId);
        return current
          ? Effect.succeed(current)
          : Effect.fail(
              new HostResourceError({
                resource: "task",
                operation: "test.getTask",
                message: `Task not found: ${taskId}`,
                details: { repoPath, taskId },
              }),
            );
      }),
    );

export type ResolvedTestTaskTransition = Omit<AtomicTaskTransition<never>, "decide"> & {
  status: string;
  cause?: import("@openducktor/workflows").TransitionCause;
};
export type TaskStoreTestOverrides = Partial<
  Omit<TaskStorePort, "transitionTask" | "saveWorkflowArtifact">
> & {
  transitionTask?: (input: ResolvedTestTaskTransition) => Effect.Effect<TaskRecord, TaskStoreError>;
  saveWorkflowArtifact?: (
    input: WorkflowArtifactWrite & {
      status?: string;
      cause?: import("@openducktor/workflows").TransitionCause;
    },
  ) => Effect.Effect<WorkflowArtifactSaveResult, TaskStoreError>;
};

export const createTaskStoreTestDouble = (overrides: TaskStoreTestOverrides): TaskStorePort => {
  const getTaskMetadata = overrides.getTaskMetadata ?? unexpectedTaskStoreCall("getTaskMetadata");
  const getTask =
    overrides.getTask ??
    (overrides.listTasks
      ? getTaskFromList(overrides.listTasks)
      : unexpectedTaskStoreCall("getTask"));
  const transitionTask: TaskStorePort["transitionTask"] = (input) =>
    getTask(input).pipe(
      Effect.flatMap((current) =>
        Effect.fromResult(input.decide(current)).pipe(
          Effect.flatMap((decision) => {
            if (decision.status === current.status) return Effect.succeed(current);
            const next: ResolvedTestTaskTransition = {
              workspaceId: input.workspaceId,
              repoPath: input.repoPath,
              taskId: input.taskId,
              status: decision.status,
            };
            if (decision.cause !== undefined) next.cause = decision.cause;
            return (overrides.transitionTask ?? unexpectedTaskStoreCall("transitionTask"))(next);
          }),
        ),
      ),
    );
  const saveWorkflowArtifact: TaskStorePort["saveWorkflowArtifact"] = (input) =>
    getTask(input).pipe(
      Effect.flatMap((current) =>
        Effect.fromResult(input.decide(current)).pipe(
          Effect.flatMap((decision) => {
            const { decide: _, ...write } = input;
            const next: Parameters<NonNullable<TaskStoreTestOverrides["saveWorkflowArtifact"]>>[0] =
              write;
            if (decision.status !== current.status) next.status = decision.status;
            if (decision.cause !== undefined) next.cause = decision.cause;
            return (
              overrides.saveWorkflowArtifact ?? unexpectedTaskStoreCall("saveWorkflowArtifact")
            )(next);
          }),
        ),
      ),
    );
  return {
    listArtifacts: unexpectedTaskStoreCall("listArtifacts"),
    readArtifact: unexpectedTaskStoreCall("readArtifact"),
    createArtifact: unexpectedTaskStoreCall("createArtifact"),
    renameArtifact: unexpectedTaskStoreCall("renameArtifact"),
    replaceArtifact: unexpectedTaskStoreCall("replaceArtifact"),
    deleteArtifact: unexpectedTaskStoreCall("deleteArtifact"),
    recordAgentSessionActivity: unexpectedTaskStoreCall("recordAgentSessionActivity"),
    clearAgentSessionsByRoles: unexpectedTaskStoreCall("clearAgentSessionsByRoles"),
    clearWorkflowArtifacts: unexpectedTaskStoreCall("clearWorkflowArtifacts"),
    clearTaskArtifacts: unexpectedTaskStoreCall("clearTaskArtifacts"),
    createTask: unexpectedTaskStoreCall("createTask"),
    deleteAgentSession: unexpectedTaskStoreCall("deleteAgentSession"),
    deleteTask: unexpectedTaskStoreCall("deleteTask"),
    diagnoseRepoStore: unexpectedTaskStoreCall("diagnoseRepoStore"),
    findTask: unexpectedTaskStoreCall("findTask"),
    listTaskReferences: unexpectedTaskStoreCall("listTaskReferences"),
    getTaskMetadata,
    getTaskDelivery: (input) =>
      getTaskMetadata(input).pipe(
        Effect.map(({ pullRequest, directMerge }) => ({ pullRequest, directMerge })),
      ),
    getWorkflowArtifact: unexpectedTaskStoreCall("getWorkflowArtifact"),
    listAgentSessionsForTasks: ({ taskIds, ...scope }) =>
      Effect.forEach(taskIds, (taskId) =>
        getTaskMetadata({ ...scope, taskId }).pipe(
          Effect.map(({ agentSessions }) => ({ taskId, agentSessions })),
        ),
      ),
    listPullRequestSyncCandidates: unexpectedTaskStoreCall("listPullRequestSyncCandidates"),
    listDirectMergeTaskIds: unexpectedTaskStoreCall("listDirectMergeTaskIds"),
    listTaskIds: unexpectedTaskStoreCall("listTaskIds"),
    listTasks: unexpectedTaskStoreCall("listTasks"),
    listMergeCandidates: unexpectedTaskStoreCall("listMergeCandidates"),
    searchTasks: unexpectedTaskStoreCall("searchTasks"),
    setDirectMerge: unexpectedTaskStoreCall("setDirectMerge"),
    setPullRequest: unexpectedTaskStoreCall("setPullRequest"),
    updateTask: unexpectedTaskStoreCall("updateTask"),
    updateAgentSessionModel: unexpectedTaskStoreCall("updateAgentSessionModel"),
    upsertAgentSession: unexpectedTaskStoreCall("upsertAgentSession"),
    ...overrides,
    getTask,
    transitionTask,
    saveWorkflowArtifact,
  };
};
