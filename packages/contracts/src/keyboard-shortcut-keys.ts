import type { AppPlatform } from "./config-schemas";
import type { ShortcutCombination, ShortcutInput } from "./keyboard-shortcut-schemas";

/** Named keys that a shortcut can use, in their `KeyboardEvent.key` spelling. */
export const NAMED_SHORTCUT_KEYS = [
  "Enter",
  "Tab",
  "Backspace",
  "Delete",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Insert",
] as const;

export const SHORTCUT_DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

const MODIFIER_KEYS = new Set([
  "Control",
  "Meta",
  "Alt",
  "AltGraph",
  "Shift",
  "CapsLock",
  "Fn",
  "FnLock",
]);

export const isShortcutKey = (key: string): boolean =>
  !MODIFIER_KEYS.has(key) &&
  (Array.from(key).length === 1 ||
    NAMED_SHORTCUT_KEYS.some((name) => name.toLowerCase() === key.toLowerCase()) ||
    /^F([1-9]|1[0-9]|2[0-4])$/i.test(key));

/** The device keys of a portable combination: `mod` is Command on macOS and Control elsewhere. */
export type ShortcutDeviceModifiers = {
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
};
export const resolveShortcutModifiers = (
  combination: ShortcutCombination,
  platform: AppPlatform,
): ShortcutDeviceModifiers => ({
  ctrl: combination.ctrl || (combination.mod && platform !== "darwin"),
  meta: combination.mod && platform === "darwin",
  alt: combination.alt,
  shift: combination.shift,
});

/**
 * The device identity of a combination, such as `ctrl+shift:k` or `meta:#1`. Two combinations
 * overlap on a device when their signatures are equal. `inputSignature` gives the same text.
 */
export const shortcutSignature = (
  combination: ShortcutCombination,
  platform: AppPlatform,
): string => {
  const { ctrl, meta, alt, shift } = resolveShortcutModifiers(combination, platform);
  const modifiers = [ctrl && "ctrl", meta && "meta", alt && "alt", shift && "shift"]
    .filter(Boolean)
    .join("+");
  const key = combination.key;
  return `${modifiers}:${key.kind === "number-row" ? `#${key.digit}` : key.key.toLowerCase()}`;
};

/**
 * The signature of a key press, or null when no shortcut may claim it: a key-up, a repeat, text
 * composition, a modifier or unsupported key, or AltGr character input outside macOS. A number-row
 * code always gives its digit, so layouts that need Shift for digits keep both number families.
 *
 * Self-contained: the preview frame script embeds this function as source text.
 */
export function inputSignature(input: ShortcutInput, platform: AppPlatform): string | null {
  if (input.phase !== "down" || input.repeat || input.composing) return null;
  const key = input.key.toLowerCase();
  const character = Array.from(input.key).length === 1;
  const named = [
    "enter",
    "tab",
    "backspace",
    "delete",
    "escape",
    "arrowup",
    "arrowdown",
    "arrowleft",
    "arrowright",
    "home",
    "end",
    "pageup",
    "pagedown",
    "insert",
  ];
  if (!character && !named.includes(key) && !/^f([1-9]|1[0-9]|2[0-4])$/.test(key)) return null;
  if (platform !== "darwin" && character && (input.altGraph === true || (input.ctrl && input.alt)))
    return null;
  const digit = /^Digit([0-9])$/.exec(input.code);
  const modifiers = [
    input.ctrl && "ctrl",
    input.meta && "meta",
    input.alt && "alt",
    input.shift && "shift",
  ]
    .filter(Boolean)
    .join("+");
  return `${modifiers}:${digit ? `#${digit[1]}` : key}`;
}

/** True while the device's `mod` key is down, which shows the position hints. */
export function holdsShortcutMod(input: ShortcutInput, platform: AppPlatform): boolean {
  return (platform === "darwin" ? input.meta : input.ctrl) && !input.composing;
}

/**
 * The portable combination of a recorded key press, or null when it cannot be a shortcut. macOS
 * records Command as `mod` and Control as `ctrl`. Windows and Linux record Control as `mod`, and
 * reject the Windows and Super keys, which the system keeps.
 */
export const recordShortcut = (
  input: ShortcutInput,
  platform: AppPlatform,
): ShortcutCombination | null => {
  if (inputSignature(input, platform) === null || MODIFIER_KEYS.has(input.key)) return null;
  const mac = platform === "darwin";
  if (!mac && input.meta) return null;
  const mod = mac ? input.meta : input.ctrl;
  const ctrl = mac && input.ctrl;
  if (!mod && !ctrl && !input.alt) return null;
  const digit = SHORTCUT_DIGITS.find((value) => input.code === `Digit${value}`);
  return {
    key:
      digit === undefined
        ? { kind: "logical", key: input.key.toLowerCase() }
        : { kind: "number-row", digit },
    mod,
    ctrl,
    alt: input.alt,
    shift: input.shift,
  };
};

/** Portable equality, as saved. */
export const sameShortcut = (
  left: ShortcutCombination | null,
  right: ShortcutCombination | null,
): boolean =>
  left === null || right === null
    ? left === right
    : left.mod === right.mod &&
      left.ctrl === right.ctrl &&
      left.alt === right.alt &&
      left.shift === right.shift &&
      (left.key.kind === "number-row"
        ? right.key.kind === "number-row" && left.key.digit === right.key.digit
        : right.key.kind === "logical" &&
          left.key.key.toLowerCase() === right.key.key.toLowerCase());
