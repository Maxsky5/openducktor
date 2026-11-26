import type { AgentSessionLiveSnapshot, SessionOperationObservation } from "@openducktor/contracts";
import type { AgentSessionAssociation } from "@openducktor/contracts";
import { agentSessionIdentityKey } from "../../../lib/agent-session-identity";
import {
  getAgentSession,
  removeAgentSession,
  replaceAgentSession,
  type AgentSessionCollection,
} from "../../agent-session-collection";
import {
  createObservedSession,
  createSessionFromLiveIdentity,
} from "./agent-session-live-projection";

/** Adds only destinations the host accepted. Saved records take ownership at commit. */
export function projectHandoffMembers(
  collection: AgentSessionCollection,
  pendingMembers: Set<string>,
  operations: Iterable<ReadonlyMap<string, SessionOperationObservation>>,
  snapshots: ReadonlyMap<string, AgentSessionLiveSnapshot>,
): AgentSessionCollection {
  let next = collection;
  const retained = new Set<string>();
  for (const entries of operations) {
    for (const operation of entries.values()) {
      const { handoff } = operation;
      const link = handoff?.acceptedLink;
      if (!handoff || !link) continue;
      const key = agentSessionIdentityKey(link.to);
      if (handoff.committed) {
        pendingMembers.delete(key);
        continue;
      }
      const existing = getAgentSession(next, link.to);
      if (existing) {
        if (pendingMembers.has(key)) retained.add(key);
        continue;
      }
      const snapshot = snapshots.get(key);
      if (!snapshot && !handoff.destinationStartedAt) continue;
      const { chat } = handoff;
      const association: AgentSessionAssociation =
        chat.kind === "task_session"
          ? {
              kind: "workflow",
              workspaceId: chat.workspaceId,
              taskId: chat.taskId,
              role: chat.role,
            }
          : { kind: "repository", workspaceId: chat.workspaceId };
      const session = snapshot
        ? createObservedSession(snapshot, association)
        : createSessionFromLiveIdentity(
            {
              ref: { ...link.to, repoPath: chat.repoPath },
              title: getAgentSession(collection, link.from)?.title ?? "Session",
              startedAt: handoff.destinationStartedAt!,
            },
            association,
          );
      next = replaceAgentSession(next, { ...session, selectedModel: handoff.destination });
      pendingMembers.add(key);
      retained.add(key);
    }
  }
  for (const key of pendingMembers) {
    if (retained.has(key)) continue;
    const session = next.get(key);
    if (session) next = removeAgentSession(next, session);
    pendingMembers.delete(key);
  }
  return next;
}
