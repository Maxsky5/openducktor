import { createElement, type PropsWithChildren, type ReactElement, use, useState } from "react";
import { createAgentSessionsStore } from "../sessions/agent-sessions-store";
import {
  type AgentMessageQueuesStore,
  createAgentMessageQueuesStore,
} from "../sessions/agent-message-queues-store";
import {
  AgentMessageQueuesContext,
  AgentSessionsContext,
  AgentOperationsContext,
  HostRuntimeStatusContext,
} from "../sessions/session-contexts";
import type {
  AgentOperationsContextValue,
  HostRuntimeStatusContextValue,
} from "../types/session-slices";
import { createAgentOperationsFixture } from "./agent-operations-fixture";
import { createHostRuntimeStatusContextValue } from "./shared-test-fixtures";

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
  const existingSessions = use(AgentSessionsContext);
  const [defaults] = useState(() => ({
    operations: createAgentOperationsFixture(),
    runtimeStatus: createHostRuntimeStatusContextValue(),
    queues: createAgentMessageQueuesStore(),
    sessions: createAgentSessionsStore(null),
  }));
  return createElement(
    AgentOperationsContext,
    { value: operations ?? defaults.operations },
    createElement(
      HostRuntimeStatusContext,
      { value: runtimeStatus ?? defaults.runtimeStatus },
      createElement(
        AgentMessageQueuesContext,
        { value: queues ?? defaults.queues },
        createElement(
          AgentSessionsContext,
          { value: existingSessions ?? defaults.sessions },
          children,
        ),
      ),
    ),
  );
}
