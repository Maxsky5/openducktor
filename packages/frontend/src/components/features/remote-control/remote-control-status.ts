/** The live device count of the local host, or that the host cannot report it. */
export function connectedDevicesLabel(count: number | null): string {
  if (count === null) return "Device status unavailable";
  if (count === 0) return "No devices connected";
  return `${count} ${count === 1 ? "device" : "devices"} connected`;
}
