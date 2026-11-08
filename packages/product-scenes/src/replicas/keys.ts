/** The modifier keys of a platform, as `platformKeyLabels` of the app writes them. */
export type KeyLabels = { readonly modifier: string; readonly alt: string };

/** The macOS keys. The site shows them. */
export const MAC_KEYS: KeyLabels = { modifier: "⌘", alt: "⌥" };

/** The keys of Windows and Linux. The tour of the app shows them on those platforms. */
export const PC_KEYS: KeyLabels = { modifier: "Ctrl", alt: "Alt" };

/** The steer shortcut of the platform of `keys`, as steerShortcutLabel of steer-shortcut.ts writes it. */
export function steerKey(keys: KeyLabels): string {
  return keys.modifier === MAC_KEYS.modifier ? `${keys.modifier} Enter` : `${keys.modifier}+Enter`;
}
