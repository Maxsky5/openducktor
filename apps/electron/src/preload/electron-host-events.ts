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

export const subscribeElectronHostEvent = <Channel extends HostEventChannel>(
  ipcRenderer: ElectronHostEventIpcRenderer,
  channel: Channel,
  listener: (payload: HostEventPayload<Channel>) => void,
): (() => void) => {
  const handleEvent: ElectronHostEventListener = (_event, envelope) => {
    const parsed = hostEventEnvelopeSchema.safeParse(envelope);
    if (!parsed.success) {
      console.error("Received invalid host event from Electron main process.", {
        issues: parsed.error.issues,
      });
      return;
    }
    if (parsed.data.channel === channel) {
      // SAFETY: The channel equality pairs this envelope branch with the requested listener.
      listener(parsed.data.payload as HostEventPayload<Channel>);
    }
  };

  ipcRenderer.on(ELECTRON_HOST_EVENT_CHANNEL, handleEvent);
  return () => ipcRenderer.off(ELECTRON_HOST_EVENT_CHANNEL, handleEvent);
};
