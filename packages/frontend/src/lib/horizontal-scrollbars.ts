import {
  DEFAULT_APPEARANCE_SETTINGS,
  type AppPlatform,
  type HorizontalScrollbarVisibility,
  resolveHorizontalScrollbarVisibility,
} from "@openducktor/contracts";
import { readDevicePlatform } from "./device-platform";

/**
 * Tells if horizontal scrollbars show. The `system` value follows the platform of this device, not
 * of the selected host.
 */
export const showsHorizontalScrollbars = (
  visibility: HorizontalScrollbarVisibility | undefined,
  platform: AppPlatform = readDevicePlatform(),
): boolean =>
  resolveHorizontalScrollbarVisibility(
    visibility ?? DEFAULT_APPEARANCE_SETTINGS.horizontalScrollbarVisibility,
    platform,
  ) === "show";
