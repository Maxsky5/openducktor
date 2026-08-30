import {
  type HostEventChannel,
  type HostEventPayload,
  type HostEventWireEnvelope,
  hostEventEnvelopeSchema,
} from "@openducktor/contracts";
import type { IpcRendererEvent } from "electron";
import { ELECTRON_HOST_EVENT_CHANNEL } from "../shared/electron-bridge-contract";

export type ElectronHostEventWireEnvelope = HostEventWireEnvelope;
export type ElectronHostEventListener = (
  event: IpcRendererEvent,
  envelope: ElectronHostEventWireEnvelope,
) => void;
type ElectronHostEventIpcRenderer = {
  off(channel: string, listener: ElectronHostEventListener): void;
  on(channel: string, listener: ElectronHostEventListener): void;
};

type ElectronHostEventSubscription = {
  [Channel in HostEventChannel]: readonly [
    channel: Channel,
    listener: (payload: HostEventPayload<Channel>) => void,
  ];
}[HostEventChannel];

export function subscribeElectronHostEvent<Channel extends HostEventChannel>(
  ipcRenderer: ElectronHostEventIpcRenderer,
  channel: Channel,
  listener: (payload: HostEventPayload<Channel>) => void,
): () => void;
export function subscribeElectronHostEvent(
  ipcRenderer: ElectronHostEventIpcRenderer,
  ...subscription: ElectronHostEventSubscription
): () => void {
  const handleEvent: ElectronHostEventListener = (_event, envelope) => {
    const parsed = hostEventEnvelopeSchema.safeParse(envelope);
    if (!parsed.success) {
      console.error("Received invalid host event from Electron main process.", {
        issues: parsed.error.issues,
      });
      return;
    }
    if (parsed.data.channel === "openducktor://run-event") {
      if (subscription[0] === parsed.data.channel) subscription[1](parsed.data.payload);
      return;
    }
    if (parsed.data.channel === "openducktor://dev-server-event") {
      if (subscription[0] === parsed.data.channel) subscription[1](parsed.data.payload);
      return;
    }
    if (subscription[0] === parsed.data.channel) subscription[1](parsed.data.payload);
  };

  ipcRenderer.on(ELECTRON_HOST_EVENT_CHANNEL, handleEvent);
  return () => ipcRenderer.off(ELECTRON_HOST_EVENT_CHANNEL, handleEvent);
}
