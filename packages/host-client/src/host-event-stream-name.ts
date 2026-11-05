import type { HostEventEnvelope } from "@openducktor/contracts";
import {
  envelopeRepoPath as agentSessionLiveEnvelopeRepoPath,
  liveSessionStreamEventName,
} from "./agent-session-live-attachment";

/** Browser tab events have their own replay buffer, so many tab updates cannot evict others. */
export const BROWSER_EVENT_STREAM_NAME = "browser";
export const STARTUP_EVENT_STREAM_NAME = "startup";

/**
 * The host event name of an envelope. The host keeps one replay buffer per name, and a client
 * selects listeners by name before it parses an event body.
 */
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
