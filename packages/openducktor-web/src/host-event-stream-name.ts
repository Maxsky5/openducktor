import type { HostEventEnvelope } from "@openducktor/contracts";
import { agentSessionLiveEnvelopeRepoPath } from "@openducktor/host-client";

// JSON escaping keeps repository paths on one SSE field line, including unusual path characters.
export const liveSessionStreamEventName = (repoPath: string): string =>
  `agent-session-live:${JSON.stringify(repoPath)}`;

export const hostEventStreamEventName = (envelope: HostEventEnvelope): string =>
  envelope.channel === "openducktor://agent-session-live-event"
    ? liveSessionStreamEventName(agentSessionLiveEnvelopeRepoPath(envelope.payload))
    : "message";
