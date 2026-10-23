import { Effect } from "effect";
import type { TaskStorePort } from "../ports/task-repository-ports";

const unexpectedTaskStoreCall = (methodName: keyof TaskStorePort) => () =>
  Effect.die(new Error(`Unexpected task store call: ${methodName}`));

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
  clearQaReports: unexpectedTaskStoreCall("clearQaReports"),
  clearTaskArtifacts: unexpectedTaskStoreCall("clearTaskArtifacts"),
  createTask: unexpectedTaskStoreCall("createTask"),
  deleteAgentSession: unexpectedTaskStoreCall("deleteAgentSession"),
  deleteTask: unexpectedTaskStoreCall("deleteTask"),
  diagnoseRepoStore: unexpectedTaskStoreCall("diagnoseRepoStore"),
  findTask: unexpectedTaskStoreCall("findTask"),
  listTaskReferences: unexpectedTaskStoreCall("listTaskReferences"),
  getTask: unexpectedTaskStoreCall("getTask"),
  getTaskMetadata: unexpectedTaskStoreCall("getTaskMetadata"),
  listAgentSessionsForTasks: unexpectedTaskStoreCall("listAgentSessionsForTasks"),
  listPullRequestSyncCandidates: unexpectedTaskStoreCall("listPullRequestSyncCandidates"),
  listTaskIds: unexpectedTaskStoreCall("listTaskIds"),
  listTasks: unexpectedTaskStoreCall("listTasks"),
  recordQaOutcome: unexpectedTaskStoreCall("recordQaOutcome"),
  setDirectMerge: unexpectedTaskStoreCall("setDirectMerge"),
  setPlanArtifact: unexpectedTaskStoreCall("setPlanArtifact"),
  setPullRequest: unexpectedTaskStoreCall("setPullRequest"),
  setSpecArtifact: unexpectedTaskStoreCall("setSpecArtifact"),
  transitionTask: unexpectedTaskStoreCall("transitionTask"),
  updateTask: unexpectedTaskStoreCall("updateTask"),
  updateAgentSessionModel: unexpectedTaskStoreCall("updateAgentSessionModel"),
  upsertAgentSession: unexpectedTaskStoreCall("upsertAgentSession"),
  ...overrides,
});
