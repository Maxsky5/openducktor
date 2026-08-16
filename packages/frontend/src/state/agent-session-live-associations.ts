import type {
  AgentSessionAssociation,
  AgentSessionLiveEnvelope,
  AgentSessionLiveSnapshot,
} from "@openducktor/contracts";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

export type AgentSessionLiveAssociations = ReadonlyMap<string, AgentSessionAssociation>;

export const emptyAgentSessionLiveAssociations = (): AgentSessionLiveAssociations => new Map();

export const getAgentSessionLiveAssociation = (
  associations: AgentSessionLiveAssociations,
  identity: AgentSessionIdentity | null,
): AgentSessionAssociation | null =>
  identity ? (associations.get(agentSessionIdentityKey(identity)) ?? null) : null;

export const buildAgentSessionLiveAssociations = (
  snapshots: readonly AgentSessionLiveSnapshot[],
): AgentSessionLiveAssociations =>
  new Map(
    snapshots.map((snapshot) => [
      agentSessionIdentityKey(snapshot.ref),
      snapshot.sessionAssociation,
    ]),
  );

const agentSessionAssociationsEqual = (
  left: AgentSessionAssociation | undefined,
  right: AgentSessionAssociation,
): boolean => {
  if (!left || left.kind !== right.kind) {
    return false;
  }
  if (left.kind !== "workflow") {
    return true;
  }
  return right.kind === "workflow" && left.taskId === right.taskId && left.role === right.role;
};

export const applyAgentSessionLiveAssociationDelta = (
  current: AgentSessionLiveAssociations,
  envelope: Extract<AgentSessionLiveEnvelope, { type: "session_upsert" | "session_removed" }>,
): AgentSessionLiveAssociations => {
  if (envelope.type === "session_upsert") {
    const key = agentSessionIdentityKey(envelope.session.ref);
    if (agentSessionAssociationsEqual(current.get(key), envelope.session.sessionAssociation)) {
      return current;
    }
    const next = new Map(current);
    next.set(key, envelope.session.sessionAssociation);
    return next;
  }
  const key = agentSessionIdentityKey(envelope.ref);
  if (!current.has(key)) {
    return current;
  }
  const next = new Map(current);
  next.delete(key);
  return next;
};
