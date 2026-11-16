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
    /**
     * Publishes the labels. Unchanged entries keep their previous object, so a consumer of one id
     * renders only when that id changes; listeners run only when something changed.
     */
    replace(next: ReadonlyMap<ShortcutActionId, ShortcutControlLabel>) {
      let changed = labels.size !== next.size;
      const shared = new Map<ShortcutActionId, ShortcutControlLabel>();
      for (const [id, value] of next) {
        const previous = labels.get(id);
        const same = previous?.label === value.label && previous.owner === value.owner;
        shared.set(id, same ? previous : value);
        if (!same) changed = true;
      }
      if (!changed) return;
      labels = shared;
      for (const listener of listeners) listener();
    },
  };
};
