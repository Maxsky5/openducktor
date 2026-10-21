import { z } from "zod";

export const browserForwardedShortcutIdSchema = z.enum(["command_palette", "toggle_bottom_panel"]);
export type BrowserForwardedShortcutId = z.infer<typeof browserForwardedShortcutIdSchema>;

export type BrowserForwardedShortcut = {
  readonly id: BrowserForwardedShortcutId;
  readonly key: string;
  /** `mod` is Cmd on macOS and Ctrl on other platforms. */
  readonly modifier: "mod" | "ctrl";
};

/** OpenDucktor shortcuts with a modifier key that keep working while a page has keyboard focus. */
export const BROWSER_FORWARDED_SHORTCUTS: readonly BrowserForwardedShortcut[] = [
  { id: "command_palette", key: "k", modifier: "mod" },
  { id: "toggle_bottom_panel", key: "`", modifier: "ctrl" },
];

export type BrowserShortcutKeyEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

/** The forwarded shortcut that a key press triggers on a platform, or `null`. */
export const matchBrowserForwardedShortcut = (
  event: BrowserShortcutKeyEvent,
  platform: string,
): BrowserForwardedShortcut | null => {
  if (event.shiftKey || event.altKey) {
    return null;
  }
  const key = event.key.toLowerCase();
  const isMac = platform === "darwin";
  for (const shortcut of BROWSER_FORWARDED_SHORTCUTS) {
    if (shortcut.key !== key) {
      continue;
    }
    const useMeta = shortcut.modifier === "mod" && isMac;
    if (useMeta ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) {
      return shortcut;
    }
  }
  return null;
};
