import type { HostEventChannel, HostEventEnvelope } from "@openducktor/contracts";
import { agentSessionLiveEnvelopeRepoPath } from "@openducktor/host-client";
import { ELECTRON_HOST_EVENT_CHANNEL } from "./electron-bridge-contract";

type ElectronHostEventScope =
  | [channel: Exclude<HostEventChannel, "openducktor://agent-session-live-event">]
  | [channel: "openducktor://agent-session-live-event", repoPath: string];

export const electronHostEventChannel = (...scope: ElectronHostEventScope): string =>
  `${ELECTRON_HOST_EVENT_CHANNEL}:${JSON.stringify(scope)}`;

export const electronHostEventEnvelopeChannel = (envelope: HostEventEnvelope): string =>
  envelope.channel === "openducktor://agent-session-live-event"
    ? electronHostEventChannel(envelope.channel, agentSessionLiveEnvelopeRepoPath(envelope.payload))
    : electronHostEventChannel(envelope.channel);
