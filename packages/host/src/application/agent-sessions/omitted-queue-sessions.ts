import type { AgentMessageQueueSnapshot, AgentSessionLiveEnvelope } from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";

/** A complete repository snapshot ends live ownership for any omitted queue session. */
export const omittedQueueSessions = (
  envelope: AgentSessionLiveEnvelope,
  listQueues: (repoPath: string) => AgentMessageQueueSnapshot[],
): AgentSessionLiveEnvelope[] => {
  if (envelope.type !== "snapshot") return [];
  const live = new Set(envelope.sessions.map((session) => agentSessionRefKey(session.ref)));
  return listQueues(envelope.repoPath)
    .filter(({ target }) => !live.has(agentSessionRefKey(target)))
    .map(({ target: { repoPath, runtimeKind, workingDirectory, externalSessionId } }) => ({
      type: "session_removed",
      ref: { repoPath, runtimeKind, workingDirectory, externalSessionId },
    }));
};
