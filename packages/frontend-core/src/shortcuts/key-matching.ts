import type { AppPlatform, ShortcutCombination, ShortcutInput } from "@openducktor/contracts";

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
const NAMED_KEYS = new Set([
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
]);

export const isShortcutKey = (key: string): boolean =>
  !MODIFIER_KEYS.has(key) &&
  (Array.from(key).length === 1 ||
    Array.from(NAMED_KEYS).some((value) => value.toLowerCase() === key.toLowerCase()) ||
    /^F([1-9]|1[0-9]|2[0-4])$/i.test(key));

export const isShortcutCharacterInput = (input: ShortcutInput, platform: AppPlatform): boolean =>
  platform !== "darwin" &&
  Array.from(input.key).length === 1 &&
  (input.altGraph === true || (input.ctrl && input.alt));

export const canUseShortcutInput = (input: ShortcutInput, platform: AppPlatform): boolean =>
  input.phase === "down" &&
  !input.repeat &&
  !input.composing &&
  isShortcutKey(input.key) &&
  !isShortcutCharacterInput(input, platform);

/** Self-contained so preview scripts can embed this same matcher without evaluating code. */
export const matchesShortcut = (
  combination: ShortcutCombination,
  input: ShortcutInput,
  platform: AppPlatform,
): boolean => {
  const key = input.key.toLowerCase();
  const supported =
    Array.from(input.key).length === 1 ||
    [
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
    ].includes(key) ||
    /^f([1-9]|1[0-9]|2[0-4])$/.test(key);
  if (input.phase !== "down" || input.repeat || input.composing || !supported) return false;
  if (
    platform !== "darwin" &&
    Array.from(input.key).length === 1 &&
    (input.altGraph === true || (input.ctrl && input.alt))
  )
    return false;
  return (
    combination.ctrl === input.ctrl &&
    combination.meta === input.meta &&
    combination.alt === input.alt &&
    combination.shift === input.shift &&
    (combination.key.kind === "number-row"
      ? input.code === `Digit${combination.key.digit}`
      : !/^Digit[0-9]$/.test(input.code) && key === combination.key.key.toLowerCase())
  );
};

export const recordShortcut = (
  input: ShortcutInput,
  platform: AppPlatform,
): ShortcutCombination | null => {
  if (!canUseShortcutInput(input, platform) || !(input.ctrl || input.meta || input.alt))
    return null;
  const digit = (["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const).find(
    (value) => input.code === `Digit${value}`,
  );
  return {
    key:
      digit === undefined
        ? { kind: "logical", key: input.key.toLowerCase() }
        : { kind: "number-row", digit },
    ctrl: input.ctrl,
    meta: input.meta,
    alt: input.alt,
    shift: input.shift,
  };
};

export const shortcutLabel = (
  combination: ShortcutCombination | null,
  platform: AppPlatform,
): string => {
  if (!combination) return "Unassigned";
  const parts: string[] = [];
  if (combination.ctrl) parts.push("Ctrl");
  if (combination.meta) parts.push(platform === "darwin" ? "⌘" : "Meta");
  if (combination.alt) parts.push(platform === "darwin" ? "Option" : "Alt");
  if (combination.shift) parts.push("Shift");
  const key = combination.key;
  parts.push(
    key.kind === "number-row"
      ? key.digit
      : key.key === " "
        ? "Space"
        : key.key.length === 1
          ? key.key.toUpperCase()
          : (Array.from(NAMED_KEYS).find((name) => name.toLowerCase() === key.key.toLowerCase()) ??
            key.key.toUpperCase()),
  );
  return parts.join("+");
};

/** Number-row and logical keys use separate input domains, as in matchesShortcut. */
export const shortcutsOverlap = (
  left: ShortcutCombination,
  right: ShortcutCombination,
): boolean => {
  if (
    left.ctrl !== right.ctrl ||
    left.meta !== right.meta ||
    left.alt !== right.alt ||
    left.shift !== right.shift
  )
    return false;
  if (left.key.kind === "number-row" && right.key.kind === "number-row")
    return left.key.digit === right.key.digit;
  if (left.key.kind === "logical" && right.key.kind === "logical")
    return left.key.key.toLowerCase() === right.key.key.toLowerCase();
  return false;
};
