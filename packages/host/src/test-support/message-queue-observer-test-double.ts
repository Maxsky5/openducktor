import type { AgentMessageQueueObserver } from "../application/agent-sessions/agent-session-live-envelope";

/** A message queue observer for live-state tests that do not use message queues. */
export const noMessageQueues: AgentMessageQueueObserver = {
  listQueues: () => [],
  observeChanges: () => {},
};
