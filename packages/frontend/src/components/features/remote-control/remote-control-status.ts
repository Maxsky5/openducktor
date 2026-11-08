import type { RemoteAccessState } from "@openducktor/contracts";

/** The live device count of the local host, or that the host cannot report it. */
export function connectedDevicesLabel(count: number | null): string {
  if (count === null) return "Device status unavailable";
  if (count === 0) return "No devices connected";
  return `${count} ${count === 1 ? "device" : "devices"} connected`;
}

/** The status text under the Remote control switch. */
export function remoteControlSwitchDescription(
  state: RemoteAccessState | undefined,
  pending: boolean,
): string {
  if (!state) return "Reading remote control status...";
  if (pending) return "Updating remote control...";
  if (state.status === "available") return `On. ${connectedDevicesLabel(state.connectedClients)}.`;
  if (state.status === "failed") return "Off. Remote control could not start.";
  return "Off. Other devices cannot connect.";
}
