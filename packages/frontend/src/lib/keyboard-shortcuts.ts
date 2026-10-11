import type { AppPlatform } from "@openducktor/contracts";

type ModifierState = Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">;

/** Cmd on macOS, Ctrl on Windows and Linux. The other key of the pair must be up. */
export const hasPlatformModifier = (
  event: Pick<KeyboardEvent, "ctrlKey" | "metaKey">,
  platform: AppPlatform,
): boolean =>
  platform === "darwin" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;

/** The platform modifier and the key, with no Shift or Alt. Give `key` in lower case. */
export const isPlatformChord = (
  event: ModifierState & Pick<KeyboardEvent, "key">,
  key: string,
  platform: AppPlatform,
): boolean =>
  hasPlatformModifier(event, platform) &&
  !event.shiftKey &&
  !event.altKey &&
  event.key.toLowerCase() === key;

/** The key cap labels of the platform modifier and the Alt key. */
export const platformKeyLabels = (platform: AppPlatform): { modifier: string; alt: string } =>
  platform === "darwin" ? { modifier: "⌘", alt: "⌥" } : { modifier: "Ctrl", alt: "Alt" };
