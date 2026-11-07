import { createElement, type PropsWithChildren, type ReactElement, use, useState } from "react";
import {
  type AgentMessageQueuesStore,
  createAgentMessageQueuesStore,
} from "../sessions/agent-message-queues-store";
import {
  type AgentSessionsStore,
  createAgentSessionsStore,
} from "../sessions/agent-sessions-store";
import {
  AgentMessageQueuesContext,
  AgentOperationsContext,
  AgentSessionsContext,
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
  sessions?: AgentSessionsStore;
}>;

/**
 * Gives the agent operations, runtime status, message queues, and sessions that `useAgentChatSend`
 * reads. A session store of an outer provider stays in use.
 * A value that the test does not give stays the same across renders.
 */
export function AgentChatSendProviders({
  operations,
  runtimeStatus,
  queues,
  sessions,
  children,
}: AgentChatSendProvidersProps): ReactElement {
  const outerSessions = use(AgentSessionsContext);
  const [defaults] = useState(() => ({
    operations: createAgentOperationsFixture(),
    runtimeStatus: createHostRuntimeStatusContextValue(),
    queues: createAgentMessageQueuesStore(),
    sessions: createAgentSessionsStore("/repo"),
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
          { value: sessions ?? outerSessions ?? defaults.sessions },
          children,
        ),
      ),
    ),
  );
}
