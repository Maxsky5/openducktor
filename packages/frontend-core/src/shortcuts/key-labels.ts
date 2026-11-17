import {
  type AppPlatform,
  NAMED_SHORTCUT_KEYS,
  resolveShortcutModifiers,
  type ShortcutCombination,
} from "@openducktor/contracts";

const MAC_KEY_NAMES = new Map([
  ["enter", "↵"],
  ["tab", "⇥"],
  ["backspace", "⌫"],
  ["delete", "⌦"],
  ["escape", "Esc"],
  ["arrowup", "↑"],
  ["arrowdown", "↓"],
  ["arrowleft", "←"],
  ["arrowright", "→"],
  ["pageup", "PgUp"],
  ["pagedown", "PgDn"],
]);
const OTHER_KEY_NAMES = new Map([
  ["delete", "Del"],
  ["escape", "Esc"],
  ["arrowup", "↑"],
  ["arrowdown", "↓"],
  ["arrowleft", "←"],
  ["arrowright", "→"],
  ["pageup", "PgUp"],
  ["pagedown", "PgDn"],
]);

const namedKey = (key: string): string =>
  NAMED_SHORTCUT_KEYS.find((name) => name.toLowerCase() === key.toLowerCase()) ?? key.toUpperCase();

const keyName = (key: ShortcutCombination["key"], platform: AppPlatform): string => {
  if (key.kind === "number-row") return key.digit;
  if (key.key === " ") return "Space";
  const named = (platform === "darwin" ? MAC_KEY_NAMES : OTHER_KEY_NAMES).get(
    key.key.toLowerCase(),
  );
  if (named) return named;
  return Array.from(key.key).length === 1 ? key.key.toUpperCase() : namedKey(key.key);
};

/**
 * Modifier keycaps in the platform's conventional order: ⌃⌥⇧⌘ on macOS, Ctrl Alt Shift elsewhere.
 * Outside macOS, Meta is not a shortcut modifier, so it has no keycap.
 */
export const modifierKeyParts = (
  { ctrl, meta, alt, shift }: { ctrl: boolean; meta: boolean; alt: boolean; shift: boolean },
  platform: AppPlatform,
): string[] => {
  const mac = platform === "darwin";
  const parts: string[] = [];
  if (ctrl) parts.push(mac ? "⌃" : "Ctrl");
  if (alt) parts.push(mac ? "⌥" : "Alt");
  if (shift) parts.push(mac ? "⇧" : "Shift");
  if (meta && mac) parts.push("⌘");
  return parts;
};

/** Keycaps in the platform's conventional order, then the key. */
export const shortcutKeyParts = (
  combination: ShortcutCombination,
  platform: AppPlatform,
): string[] => [
  ...modifierKeyParts(resolveShortcutModifiers(combination, platform), platform),
  keyName(combination.key, platform),
];

/** The modifiers that a recorded shortcut needs, as keycaps and as spoken words. */
export const recordingModifierNames = (platform: AppPlatform) =>
  platform === "darwin"
    ? { keys: "⌘ ⌃ or ⌥", words: "Command, Control or Option" }
    : { keys: "Ctrl or Alt", words: "Ctrl or Alt" };

export const shortcutLabel = (
  combination: ShortcutCombination | null,
  platform: AppPlatform,
): string =>
  combination
    ? shortcutKeyParts(combination, platform).join(platform === "darwin" ? "" : "+")
    : "Unassigned";

/** The WAI-ARIA `aria-keyshortcuts` value, which uses platform-independent key names. */
export const ariaKeyShortcut = (
  combination: ShortcutCombination,
  platform: AppPlatform,
): string => {
  const { ctrl, meta, alt, shift } = resolveShortcutModifiers(combination, platform);
  const parts: string[] = [];
  if (ctrl) parts.push("Control");
  if (meta) parts.push("Meta");
  if (alt) parts.push("Alt");
  if (shift) parts.push("Shift");
  const key = combination.key;
  parts.push(
    key.kind === "number-row"
      ? key.digit
      : key.key === " "
        ? "Space"
        : Array.from(key.key).length === 1
          ? key.key.toUpperCase()
          : namedKey(key.key),
  );
  return parts.join("+");
};

const SPOKEN_KEYS = new Map([
  ["⌘", "Command"],
  ["⌃", "Control"],
  ["⌥", "Option"],
  ["⇧", "Shift"],
  ["↵", "Return"],
  ["⇥", "Tab"],
  ["⌫", "Delete"],
  ["⌦", "Forward Delete"],
  ["↑", "Up Arrow"],
  ["↓", "Down Arrow"],
  ["←", "Left Arrow"],
  ["→", "Right Arrow"],
  ["Esc", "Escape"],
  ["PgUp", "Page Up"],
  ["PgDn", "Page Down"],
  ["Del", "Delete"],
]);

/** Words a screen reader can say, such as "Shift Command K", since symbols read poorly. */
export const spokenShortcut = (combination: ShortcutCombination, platform: AppPlatform): string =>
  shortcutKeyParts(combination, platform)
    .map((part) => SPOKEN_KEYS.get(part) ?? part)
    .join(" ");
