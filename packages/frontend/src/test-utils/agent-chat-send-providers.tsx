import { type PropsWithChildren, type ReactElement, useState } from "react";
import {
  type AgentMessageQueuesStore,
  createAgentMessageQueuesStore,
} from "@openducktor/frontend-core/sessions/agent-message-queues-store";
import {
  AgentMessageQueuesContext,
  AgentOperationsContext,
  HostRuntimeStatusContext,
} from "@openducktor/frontend-core/sessions/session-contexts";
import type {
  AgentOperationsContextValue,
  HostRuntimeStatusContextValue,
} from "@/types/state-slices";
import { createAgentOperationsFixture } from "@openducktor/frontend-core/test-support/agent-operations-fixture";
import { createHostRuntimeStatusContextValue } from "@/test-utils/shared-test-fixtures";

type AgentChatSendProvidersProps = PropsWithChildren<{
  operations?: AgentOperationsContextValue;
  runtimeStatus?: HostRuntimeStatusContextValue;
  queues?: AgentMessageQueuesStore;
}>;

/**
 * Gives the agent operations, runtime status, and message queues that `useAgentChatSend` reads.
 * A value that the test does not give stays the same across renders.
 */
export function AgentChatSendProviders({
  operations,
  runtimeStatus,
  queues,
  children,
}: AgentChatSendProvidersProps): ReactElement {
  const [defaults] = useState(() => ({
    operations: createAgentOperationsFixture(),
    runtimeStatus: createHostRuntimeStatusContextValue(),
    queues: createAgentMessageQueuesStore(),
  }));
  return (
    <AgentOperationsContext value={operations ?? defaults.operations}>
      <HostRuntimeStatusContext value={runtimeStatus ?? defaults.runtimeStatus}>
        <AgentMessageQueuesContext value={queues ?? defaults.queues}>
          {children}
        </AgentMessageQueuesContext>
      </HostRuntimeStatusContext>
    </AgentOperationsContext>
  );
}
