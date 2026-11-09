import type { ShortcutActionId } from "@openducktor/contracts";
import { use, useSyncExternalStore } from "react";
import { CommandPaletteRegistryContext } from "../command-palette/command-palette-registry";
const emptySnapshot = () => null;
const noSubscription = () => () => {};
export function useShortcutLabel(
  id: ShortcutActionId | undefined,
  purpose: "assignment" | "control" = "assignment",
  owners: readonly string[] = [],
): string | null {
  const store = use(CommandPaletteRegistryContext)?.shortcutLabels;
  const label = useSyncExternalStore(
    store?.subscribe ?? noSubscription,
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
