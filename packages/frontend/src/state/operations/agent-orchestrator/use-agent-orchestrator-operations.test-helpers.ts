import type { AcceptedAgentUserMessage, SendAgentUserMessageInput } from "@openducktor/core";
import { serializeAgentUserMessagePartsToText } from "@openducktor/core";

export { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
export { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
export { toast } from "sonner";
export { clearAppQueryClient } from "@/lib/query-client";
export { sessionMessagesToArray } from "@/test-utils/session-message-test-helpers";
export { host } from "../shared/host";
export { createSessionMessagesState } from "./support/messages";
export { createAgentSessionRuntimeSnapshotFixture } from "./test-utils";
export {
  type OpencodeSdkAdapterPrototype,
  opencodeSdkAdapterPrototype,
  type ReadSessionRuntimeSnapshotInput,
  setupOrchestratorOperationsTestEnvironment,
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
  createHookHarness,
  createTestDependencies,
  type OrchestratorDependencies,
} from "./use-agent-orchestrator-operations.test-harness";
export { createDeferred } from "./use-agent-orchestrator-operations.test-support";

export const acceptedUserMessageForInput = (
  input: SendAgentUserMessageInput,
  messageId = "accepted-user-message",
): AcceptedAgentUserMessage => ({
  type: "user_message",
  externalSessionId: input.externalSessionId,
  timestamp: "2026-02-22T08:00:01.000Z",
  messageId,
  message: serializeAgentUserMessagePartsToText(input.parts),
  parts: [],
  state: "read",
  ...(input.model ? { model: input.model } : {}),
});
