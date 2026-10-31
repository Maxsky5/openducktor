import type { HostEventEnvelope } from "@openducktor/contracts";
import {
  agentSessionLiveEnvelopeRepoPath,
  liveSessionStreamEventName,
} from "@openducktor/host-client";

/** Browser tab events have their own replay buffer, so many tab updates cannot evict others. */
export const BROWSER_EVENT_STREAM_NAME = "browser";
export const STARTUP_EVENT_STREAM_NAME = "startup";

export { liveSessionStreamEventName };

export const hostEventStreamEventName = (envelope: HostEventEnvelope): string => {
  switch (envelope.channel) {
    case "openducktor://agent-session-live-event":
      return liveSessionStreamEventName(agentSessionLiveEnvelopeRepoPath(envelope.payload));
    case "openducktor://browser-event":
      return BROWSER_EVENT_STREAM_NAME;
    case "openducktor://session-startup-progress":
      return STARTUP_EVENT_STREAM_NAME;
    default:
      return "message";
  }
};
