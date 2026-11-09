import type { ShortcutInput } from "@openducktor/contracts";
export const shortcutInputFromEvent = (event: KeyboardEvent): ShortcutInput => ({
  phase: event.type === "keyup" ? "up" : "down",
  key: event.key,
  code: event.code,
  ctrl: event.ctrlKey,
  meta: event.metaKey,
  alt: event.altKey,
  shift: event.shiftKey,
  composing: event.isComposing,
  repeat: event.repeat,
  altGraph: event.getModifierState("AltGraph"),
});
