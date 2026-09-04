import { Effect } from "effect";
import type { TaskStorePort } from "../ports/task-repository-ports";

const unexpectedTaskStoreCall = (methodName: keyof TaskStorePort) => () =>
  Effect.dieMessage(`Unexpected task store call: ${methodName}`);

export const createTaskStoreTestDouble = <Overrides extends Partial<TaskStorePort>>(
  overrides: Overrides,
): TaskStorePort => ({
  clearAgentSessionsByRoles: unexpectedTaskStoreCall("clearAgentSessionsByRoles"),
  clearQaReports: unexpectedTaskStoreCall("clearQaReports"),
  clearWorkflowDocuments: unexpectedTaskStoreCall("clearWorkflowDocuments"),
  createTask: unexpectedTaskStoreCall("createTask"),
  deleteAgentSession: unexpectedTaskStoreCall("deleteAgentSession"),
  deleteTask: unexpectedTaskStoreCall("deleteTask"),
  diagnoseRepoStore: unexpectedTaskStoreCall("diagnoseRepoStore"),
  findExistingTaskIds: unexpectedTaskStoreCall("findExistingTaskIds"),
  getTask: unexpectedTaskStoreCall("getTask"),
  getTaskMetadata: unexpectedTaskStoreCall("getTaskMetadata"),
  listAgentSessionsForTasks: unexpectedTaskStoreCall("listAgentSessionsForTasks"),
  listPullRequestSyncCandidates: unexpectedTaskStoreCall("listPullRequestSyncCandidates"),
  listTasks: unexpectedTaskStoreCall("listTasks"),
  recordQaOutcome: unexpectedTaskStoreCall("recordQaOutcome"),
  setDirectMerge: unexpectedTaskStoreCall("setDirectMerge"),
  setPlanDocument: unexpectedTaskStoreCall("setPlanDocument"),
  setPullRequest: unexpectedTaskStoreCall("setPullRequest"),
  setSpecDocument: unexpectedTaskStoreCall("setSpecDocument"),
  transitionTask: unexpectedTaskStoreCall("transitionTask"),
  updateTask: unexpectedTaskStoreCall("updateTask"),
  updateAgentSessionModel: unexpectedTaskStoreCall("updateAgentSessionModel"),
  upsertAgentSession: unexpectedTaskStoreCall("upsertAgentSession"),
  ...overrides,
});
