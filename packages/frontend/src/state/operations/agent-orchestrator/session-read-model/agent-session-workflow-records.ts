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

/** Workflow session records loaded from the task store; a future record source can supply the same shape. */
export type LoadedWorkflowSessionRecords = {
  /** Owning ids whose durable lists were read successfully; an unread owner never proves deletion. */
  loadedTaskIds: ReadonlySet<string>;
  records: readonly PersistedTaskSessionRecord[];
};

const persistedRecordIdentityKeys = (records: readonly PersistedTaskSessionRecord[]): Set<string> =>
  new Set(records.map(({ record }) => agentSessionIdentityKey(toPersistedSessionIdentity(record))));

const pruneRecordlessWorkflowSessions = (
  projected: AgentSessionCollection,
  { loadedTaskIds, records }: LoadedWorkflowSessionRecords,
): AgentSessionCollection => {
  const persistedKeys = persistedRecordIdentityKeys(records);
  let collection = projected;
  for (const session of listAgentSessions(projected)) {
    if (!isWorkflowAgentSession(session)) {
      continue;
    }
    const recordDisappeared =
      loadedTaskIds.has(session.sessionAssociation.taskId) &&
      session.status !== "starting" &&
      session.livePresence === "absent" &&
      !persistedKeys.has(agentSessionIdentityKey(session));
    if (recordDisappeared) {
      collection = removeAgentSession(collection, session);
    }
  }
  return collection;
};

/**
 * Drops workflow sessions whose record vanished, without touching any other
 * field. Deltas use this pass so a stale record cache cannot rewrite saved
 * fields that are already fresher in memory.
 */
export const pruneVanishedWorkflowSessions = ({
  projected,
  records: workflowRecords,
}: {
  projected: AgentSessionCollection;
  records: LoadedWorkflowSessionRecords;
}): AgentSessionCollection => {
  const collection = pruneRecordlessWorkflowSessions(projected, workflowRecords);
  return collection === projected ? projected : rebuildProjectedPendingInput(collection);
};

export const applyWorkflowSessionRecords = ({
  repoPath,
  projected,
  records: workflowRecords,
  associationEvidence,
  existingSelectedModelSource = "record",
}: {
  repoPath: string;
  projected: AgentSessionCollection;
  records: LoadedWorkflowSessionRecords;
  associationEvidence: AgentSessionCollection;
  existingSelectedModelSource?: "record" | "current";
}): AgentSessionCollection => {
  const pruned = pruneRecordlessWorkflowSessions(projected, workflowRecords);
  let collection = pruned;
  for (const persistedRecord of workflowRecords.records) {
    const identity = toPersistedSessionIdentity(persistedRecord.record);
    const currentSession = getAgentSession(collection, identity);
    const persistedInput: Parameters<typeof toPersistedSessionView>[0] = {
      ...persistedRecord,
      repoPath,
    };
    if (currentSession) {
      persistedInput.current = currentSession;
    } else {
      const evidenceSession = getAgentSession(associationEvidence, identity);
      if (evidenceSession) {
        persistedInput.associationEvidence = evidenceSession.sessionAssociation;
      }
    }
    const persistedView = toPersistedSessionView(persistedInput);
    const reconciledView =
      currentSession && existingSelectedModelSource === "current"
        ? { ...persistedView, selectedModel: currentSession.selectedModel }
        : persistedView;
    collection = replaceAgentSession(collection, reconciledView);
  }
  return rebuildProjectedPendingInput(collection);
};
