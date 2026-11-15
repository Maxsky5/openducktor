import {
  type AppPlatform,
  NAMED_SHORTCUT_KEYS,
  resolveShortcutModifiers,
  type ShortcutCombination,
} from "@openducktor/contracts";

const MAC_KEY_NAMES = new Map([
  ["enter", "↩"],
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

/** Keycaps in the platform's conventional order: ⌃⌥⇧⌘ on macOS, Ctrl Alt Shift elsewhere. */
export const shortcutKeyParts = (
  combination: ShortcutCombination,
  platform: AppPlatform,
): string[] => {
  const { ctrl, meta, alt, shift } = resolveShortcutModifiers(combination, platform);
  const parts: string[] = [];
  if (platform === "darwin") {
    if (ctrl) parts.push("⌃");
    if (alt) parts.push("⌥");
    if (shift) parts.push("⇧");
    if (meta) parts.push("⌘");
  } else {
    if (ctrl) parts.push("Ctrl");
    if (alt) parts.push("Alt");
    if (shift) parts.push("Shift");
  }
  parts.push(keyName(combination.key, platform));
  return parts;
};

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
