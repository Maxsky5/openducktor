import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  type AgentSessionCollection,
  getAgentSession,
  listAgentSessions,
  removeAgentSession,
  replaceAgentSession,
} from "@/state/agent-session-collection";
import type { PersistedTaskSessionRecord } from "../support/persistence";
import { toPersistedSessionIdentity, toPersistedSessionView } from "../support/persistence";
import { isWorkflowAgentSession } from "../support/workflow-session";
import { rebuildProjectedPendingInput } from "./agent-session-live-projection";

/** Durable session records feeding the overlay; a future record source can supply the same shape. */
export type DurableWorkflowSessionRecords = {
  /** Owning ids whose durable lists were read successfully; an unread owner never proves deletion. */
  loadedTaskIds: ReadonlySet<string>;
  records: readonly PersistedTaskSessionRecord[];
};

const persistedRecordIdentityKeys = (records: readonly PersistedTaskSessionRecord[]): Set<string> =>
  new Set(records.map(({ record }) => agentSessionIdentityKey(toPersistedSessionIdentity(record))));

export const applyWorkflowSessionRecordOverlay = ({
  projected,
  durableRecords,
}: {
  projected: AgentSessionCollection;
  durableRecords: DurableWorkflowSessionRecords;
}): AgentSessionCollection => {
  const { loadedTaskIds, records } = durableRecords;
  const persistedKeys = persistedRecordIdentityKeys(records);
  let collection = projected;
  for (const session of listAgentSessions(projected)) {
    if (!isWorkflowAgentSession(session)) {
      continue;
    }
    const recordDisappeared =
      loadedTaskIds.has(session.sessionAssociation.taskId) &&
      session.status !== "starting" &&
      // Only sessions known to be unreported can be pruned. An unset flag
      // belongs to a fresh launch whose live evidence has not arrived yet.
      session.liveReported === false &&
      !persistedKeys.has(agentSessionIdentityKey(session));
    if (recordDisappeared) {
      collection = removeAgentSession(collection, session);
    }
  }
  for (const persistedRecord of records) {
    const identity = toPersistedSessionIdentity(persistedRecord.record);
    const currentSession = getAgentSession(collection, identity);
    collection = replaceAgentSession(
      collection,
      toPersistedSessionView({
        ...persistedRecord,
        ...(currentSession ? { current: currentSession } : {}),
      }),
    );
  }
  return rebuildProjectedPendingInput(collection);
};
