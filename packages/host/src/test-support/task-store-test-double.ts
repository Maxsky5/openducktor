import { Effect } from "effect";
import { HostResourceError } from "../effect/host-errors";
import type { TaskStorePort } from "../ports/task-repository-ports";

const unexpectedTaskStoreCall = (methodName: keyof TaskStorePort) => () =>
  Effect.die(new Error(`Unexpected task store call: ${methodName}`));

/** A double that lists tasks reads one task from the same list, as the real store does. */
const getTaskFromList =
  (listTasks: TaskStorePort["listTasks"]): TaskStorePort["getTask"] =>
  ({ repoPath, taskId }) =>
    listTasks({ repoPath }).pipe(
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

export const createTaskStoreTestDouble = <Overrides extends Partial<TaskStorePort>>(
  overrides: Overrides,
): TaskStorePort => ({
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
  getTask: overrides.listTasks
    ? getTaskFromList(overrides.listTasks)
    : unexpectedTaskStoreCall("getTask"),
  getTaskMetadata: unexpectedTaskStoreCall("getTaskMetadata"),
  listAgentSessionsForTasks: unexpectedTaskStoreCall("listAgentSessionsForTasks"),
  listPullRequestSyncCandidates: unexpectedTaskStoreCall("listPullRequestSyncCandidates"),
  listDirectMergeTaskIds: unexpectedTaskStoreCall("listDirectMergeTaskIds"),
  listTaskIds: unexpectedTaskStoreCall("listTaskIds"),
  listTasks: unexpectedTaskStoreCall("listTasks"),
  setDirectMerge: unexpectedTaskStoreCall("setDirectMerge"),
  setPullRequest: unexpectedTaskStoreCall("setPullRequest"),
  saveWorkflowArtifact: unexpectedTaskStoreCall("saveWorkflowArtifact"),
  transitionTask: unexpectedTaskStoreCall("transitionTask"),
  updateTask: unexpectedTaskStoreCall("updateTask"),
  updateAgentSessionModel: unexpectedTaskStoreCall("updateAgentSessionModel"),
  upsertAgentSession: unexpectedTaskStoreCall("upsertAgentSession"),
  ...overrides,
});
