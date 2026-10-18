import type { AppPlatform } from "@openducktor/contracts";

/** Apple platforms use Command for shortcuts. Windows and Linux use Control. */
export const isApplePlatform = (platform: string = globalThis.navigator?.platform ?? ""): boolean =>
  /mac|iphone|ipad|ipod/i.test(platform);

/**
 * Returns the platform of this device. Key labels, shortcuts, and scrollbars follow this device,
 * also when the selected host runs on another platform.
 */
export const readDevicePlatform = (
  platform: string = globalThis.navigator?.platform ?? "",
): AppPlatform => {
  if (isApplePlatform(platform)) return "darwin";
  return /^win/i.test(platform) ? "win32" : "linux";
};
