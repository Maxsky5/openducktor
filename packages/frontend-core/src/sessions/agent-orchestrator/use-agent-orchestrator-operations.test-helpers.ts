import type { AcceptedAgentUserMessage, SendAgentUserMessageInput } from "@openducktor/core";
import { serializeAgentUserMessagePartsToText } from "@openducktor/core";
export { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";

export { AgentRuntimeTestAdapter } from "../../test-support/agent-runtime-test-adapter";
export { sessionMessagesToArray } from "../../test-support/session-message-test-helpers";
export { createSessionMessagesState } from "./support/messages";
export {
  setupOrchestratorOperationsTestEnvironment,
  type OrchestratorOperationsTestEnvironment,
} from "./use-agent-orchestrator-operations.test-environment";
export {
  BUILD_SELECTION,
  buildBootstrapFixture,
  createUnavailableBuildTaskFixture,
  createWorktreeRuntimeFixture,
  persistedSessionFixture,
  taskFixture,
  taskFixture2WithPersistedBuildSession,
  taskFixtureWithPersistedBuildSession,
} from "./use-agent-orchestrator-operations.test-fixtures";
export {
  createAgentSessionLiveSnapshotFixture,
  createHookHarness,
  createLiveSessionStreamFixture,
  createTestDependencies,
  listHarnessSessions,
  type OrchestratorDependencies,
} from "./use-agent-orchestrator-operations.test-harness";
export { createDeferred } from "./use-agent-orchestrator-operations.test-support";

export const acceptedUserMessageForInput = (
  input: SendAgentUserMessageInput,
  messageId = "accepted-user-message",
): AcceptedAgentUserMessage => {
  const message: AcceptedAgentUserMessage = {
    type: "user_message",
    externalSessionId: input.externalSessionId,
    timestamp: "2026-02-22T08:00:01.000Z",
    messageId,
    message: serializeAgentUserMessagePartsToText(input.parts),
    parts: [],
    state: "read",
  };
  return message;
};
