import type { AgentMessageQueueSnapshot, AgentSessionLiveRef } from "@openducktor/contracts";
import { useSyncExternalStore } from "react";
import type { AgentSessionVisiblePendingInput } from "./agent-session-visible-pending-input";
import type {
  AgentActivitySessionsSnapshot,
  AgentSessionPendingInputSummary,
  AgentSessionSummary,
} from "./agent-session-snapshots";
import { useAgentMessageQueuesContext, useAgentSessionsContext } from "./session-contexts";
import type { AgentSessionIdentity, AgentSessionState } from "../types/agent-orchestrator";

/**
 * One field of the activity snapshot. A chat change gives the snapshot a new object, so a reader
 * of the whole snapshot would render again for each chat change.
 */
const useActivitySnapshotField = <Field extends keyof AgentActivitySessionsSnapshot>(
  field: Field,
): AgentActivitySessionsSnapshot[Field] => {
  const sessionStore = useAgentSessionsContext();
  const read = () => sessionStore.getActivitySnapshot()[field];
  return useSyncExternalStore(sessionStore.subscribe, read, read);
};

export const useAgentSessionSummaries = (): AgentSessionSummary[] =>
  useActivitySnapshotField("sessions");

export const useAgentPendingInputSessions = (): AgentSessionPendingInputSummary[] =>
  useActivitySnapshotField("pendingInputSessions");

export const useAgentSession = (
  identity: AgentSessionIdentity | null,
): AgentSessionState | null => {
  const sessionStore = useAgentSessionsContext();
  return useSyncExternalStore(
    sessionStore.subscribe,
    () => sessionStore.getSessionSnapshot(identity),
    () => sessionStore.getSessionSnapshot(identity),
  );
};

/** Reads the host message queue of one session, or null when it has nothing to show. */
export const useAgentMessageQueue = (
  ref: AgentSessionLiveRef | null,
): AgentMessageQueueSnapshot | null => {
  const queues = useAgentMessageQueuesContext();
  return useSyncExternalStore(
    queues.subscribe,
    () => queues.getQueue(ref),
    () => queues.getQueue(ref),
  );
};

export const useAgentSessionVisiblePendingInput = (
  identity: AgentSessionIdentity | null,
): AgentSessionVisiblePendingInput => {
  const sessionStore = useAgentSessionsContext();
  return useSyncExternalStore(
    sessionStore.subscribe,
    () => sessionStore.getVisiblePendingInputSnapshot(identity),
    () => sessionStore.getVisiblePendingInputSnapshot(identity),
  );
};
