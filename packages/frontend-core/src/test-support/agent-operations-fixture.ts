import type { AgentOperationsContextValue } from "../types/session-slices";

const unexpectedOperation = (name: string) => async (): Promise<never> => {
  throw new Error(`Unexpected ${name}`);
};

/** Agent operations that fail when a test calls an operation that it did not override. */
export const createAgentOperationsFixture = (
  overrides: Partial<AgentOperationsContextValue> = {},
): AgentOperationsContextValue => ({
  describeGeneratedImages: unexpectedOperation("describeGeneratedImages"),
  beginGeneratedImageBatch: unexpectedOperation("beginGeneratedImageBatch"),
  releaseGeneratedImageBatch: unexpectedOperation("releaseGeneratedImageBatch"),
  readGeneratedImage: unexpectedOperation("readGeneratedImage"),
  readSessionTodos: unexpectedOperation("readSessionTodos"),
  readSessionHistory: unexpectedOperation("readSessionHistory"),
  loadAgentSessionHistory: unexpectedOperation("loadAgentSessionHistory"),
  loadAgentSessionContext: unexpectedOperation("loadAgentSessionContext"),
  sendAgentMessage: unexpectedOperation("sendAgentMessage"),
  manageAgentMessageQueue: unexpectedOperation("manageAgentMessageQueue"),
  stopAgentSession: unexpectedOperation("stopAgentSession"),
  continueInterruptedTurn: unexpectedOperation("continueInterruptedTurn"),
  updateAgentSessionModel: unexpectedOperation("updateAgentSessionModel"),
  replyAgentApproval: unexpectedOperation("replyAgentApproval"),
  answerAgentQuestion: unexpectedOperation("answerAgentQuestion"),
  ...overrides,
});
