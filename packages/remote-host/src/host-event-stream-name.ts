import type { HostEventEnvelope } from "@openducktor/contracts";
import { agentSessionLiveEnvelopeRepoPath } from "@openducktor/host-client";

/** Browser tab events have their own replay buffer, so many tab updates cannot evict others. */
export const BROWSER_EVENT_STREAM_NAME = "browser";

// JSON escaping keeps repository paths on one SSE field line, including unusual path characters.
export const liveSessionStreamEventName = (repoPath: string): string =>
  `agent-session-live:${JSON.stringify(repoPath)}`;

export const hostEventStreamEventName = (envelope: HostEventEnvelope): string => {
  switch (envelope.channel) {
    case "openducktor://agent-session-live-event":
      return liveSessionStreamEventName(agentSessionLiveEnvelopeRepoPath(envelope.payload));
    case "openducktor://browser-event":
      return BROWSER_EVENT_STREAM_NAME;
    default:
      return "message";
  }
};
