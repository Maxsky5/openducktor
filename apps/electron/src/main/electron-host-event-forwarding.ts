import type { HostEventChannel } from "@openducktor/host";
import type { ElectronHostEventEnvelope } from "../shared/electron-bridge-contract";

type ElectronHostEventWindow = {
  isDestroyed(): boolean;
  webContents: {
    isDestroyed(): boolean;
    send(channel: string, envelope: ElectronHostEventEnvelope): void;
  };
};

export const forwardElectronHostEvent = (
  windows: readonly ElectronHostEventWindow[],
  ipcChannel: string,
  envelope: ElectronHostEventEnvelope & { channel: HostEventChannel },
  reportDeliveryFailure: (failure: { channel: HostEventChannel; cause: unknown }) => void,
): void => {
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
