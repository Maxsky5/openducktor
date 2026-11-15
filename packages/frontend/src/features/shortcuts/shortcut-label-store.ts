import type { AppPlatform, ShortcutActionId, ShortcutCombination } from "@openducktor/contracts";
import {
  ariaKeyShortcut,
  shortcutKeyParts,
  shortcutLabel,
} from "@openducktor/frontend-core/shortcuts/key-labels";

export type ShortcutControlLabel = {
  label: string;
  keys: readonly string[];
  aria: string;
  owner: string | null | undefined;
};

export const shortcutControlLabel = (
  combination: ShortcutCombination,
  platform: AppPlatform,
  owner: string | null | undefined,
): ShortcutControlLabel => ({
  label: shortcutLabel(combination, platform),
  keys: shortcutKeyParts(combination, platform),
  aria: ariaKeyShortcut(combination, platform),
  owner,
});

/** An undefined owner is inactive; null is app-wide; a key identifies the local owner. */
export const createShortcutLabelStore = () => {
  let labels: ReadonlyMap<ShortcutActionId, ShortcutControlLabel> = new Map();
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => labels,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    replace(next: ReadonlyMap<ShortcutActionId, ShortcutControlLabel>) {
      if (
        labels.size === next.size &&
        Array.from(next).every(([id, value]) => {
          const previous = labels.get(id);
          return previous?.label === value.label && previous.owner === value.owner;
        })
      )
        return;
      labels = next;
      for (const listener of listeners) listener();
    },
  };
};
