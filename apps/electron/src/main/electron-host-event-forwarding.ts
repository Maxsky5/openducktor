import type { HostEventChannel } from "@openducktor/contracts";
import type { ElectronHostEventEnvelope } from "../shared/electron-bridge-contract";
import { electronHostEventEnvelopeChannel } from "../shared/electron-host-event-channel";

type ElectronHostEventWindow = {
  isDestroyed(): boolean;
  webContents: {
    isDestroyed(): boolean;
    send(channel: string, envelope: ElectronHostEventEnvelope): void;
  };
};

export const forwardElectronHostEvent = (
  windows: readonly ElectronHostEventWindow[],
  envelope: ElectronHostEventEnvelope,
  reportDeliveryFailure: (failure: { channel: HostEventChannel; cause: unknown }) => void,
): void => {
  const ipcChannel = electronHostEventEnvelopeChannel(envelope);
  for (const window of windows) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      continue;
    }

    try {
      window.webContents.send(ipcChannel, envelope);
    } catch (cause) {
      reportDeliveryFailure({ channel: envelope.channel, cause });
    }
  }
};
