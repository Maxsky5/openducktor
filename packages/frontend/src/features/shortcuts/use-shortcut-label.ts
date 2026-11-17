import type { ShortcutActionId } from "@openducktor/contracts";
import { use, useSyncExternalStore } from "react";
import { CommandPaletteRegistryContext } from "../command-palette/command-palette-registry-context";
import type { ShortcutControlLabel } from "./shortcut-label-store";
const emptySnapshot = () => null;
const noSubscription = () => () => {};
/** The published keycaps of an app-wide assignment, or null when it cannot run here. */
export function useShortcutKeys(id: ShortcutActionId): ShortcutControlLabel | null {
  const store = use(CommandPaletteRegistryContext)?.shortcutLabels;
  return useSyncExternalStore(
    store?.subscribe ?? noSubscription,
    () => store?.getSnapshot().get(id) ?? null,
    emptySnapshot,
  );
}

export function useShortcutLabel(
  id: ShortcutActionId | undefined,
  purpose: "assignment" | "control" = "assignment",
  owners: readonly string[] = [],
): string | null {
  const store = use(CommandPaletteRegistryContext)?.shortcutLabels;
  // A control without a shortcut never shows a label, so it does not listen to label changes.
  const label = useSyncExternalStore(
    (id && store?.subscribe) || noSubscription,
    () => {
      const value = id ? store?.getSnapshot().get(id) : null;
      if (
        purpose === "control" &&
        (value?.owner === undefined || (value.owner !== null && !owners.includes(value.owner)))
      )
        return null;
      return value?.label ?? null;
    },
    emptySnapshot,
  );
  return label;
}
