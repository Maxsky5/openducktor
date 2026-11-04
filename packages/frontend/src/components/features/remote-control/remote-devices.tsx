import type { ReactElement } from "react";
import type { RemoteAccessBridge, RemoteAccessState } from "@openducktor/contracts";
import { PairedDevices } from "./paired-devices";
import { PairingPanel } from "./pairing-panel";

type RemoteDevicesProps = {
  bridge: RemoteAccessBridge;
  state: RemoteAccessState;
};

/**
 * Add device and the paired devices of the local host. Add device shows while remote control is
 * on. The device list shows while remote control is on, or while it has devices.
 */
export function RemoteDevices({ bridge, state }: RemoteDevicesProps): ReactElement {
  const endpoint = state.status === "available" ? state.configuration?.publicEndpoint : undefined;
  return (
    <>
      {endpoint ? (
        <PairingPanel
          key={endpoint}
          bridge={bridge}
          endpoint={endpoint}
          pairing={state.pairing}
          pairingEnd={state.pairingEnd}
        />
      ) : null}
      {endpoint || state.clients?.length ? (
        <PairedDevices bridge={bridge} clients={state.clients} />
      ) : null}
    </>
  );
}
