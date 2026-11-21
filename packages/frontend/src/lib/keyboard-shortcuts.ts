import type { AppPlatform } from "@openducktor/contracts";

/** Cmd on macOS, Ctrl on Windows and Linux. The other key of the pair must be up. */
export const hasPlatformModifier = (
  event: Pick<KeyboardEvent, "ctrlKey" | "metaKey">,
  platform: AppPlatform,
): boolean =>
  platform === "darwin" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;

/** The key cap labels of the platform modifier and the Alt key. */
export const platformKeyLabels = (platform: AppPlatform): { modifier: string; alt: string } =>
  platform === "darwin" ? { modifier: "⌘", alt: "⌥" } : { modifier: "Ctrl", alt: "Alt" };
