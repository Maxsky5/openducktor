import { isApplePlatform } from "./device-platform";

type SteerShortcutEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

/** Command+Enter on macOS, or Control+Enter on Windows and Linux, steers the composed message. */
export const isSteerShortcut = (
  event: SteerShortcutEvent,
  applePlatform: boolean = isApplePlatform(),
): boolean => {
  if (event.key !== "Enter" || event.shiftKey || event.altKey) return false;
  return applePlatform ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
};

export const steerShortcutLabel = (applePlatform: boolean = isApplePlatform()): string =>
  applePlatform ? "⌘ Enter" : "Ctrl+Enter";
