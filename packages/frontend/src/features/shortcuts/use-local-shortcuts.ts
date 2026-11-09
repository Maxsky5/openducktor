import type { ShortcutActionId } from "@openducktor/contracts";
import { useId, type RefObject } from "react";
import { useCommandPalettePageCommands } from "../command-palette/command-palette-context";
export type LocalShortcutAction = {
  id: ShortcutActionId;
  label?: string;
  run(): void;
  disabledReason?: string | null;
  localOnly?: boolean;
  ownsInput?: boolean;
};
/** Local operations share their control handlers and require focus in their owning view. */
export function useLocalShortcuts(
  root: RefObject<HTMLElement | null>,
  actions: readonly LocalShortcutAction[],
  ownerSelector?: string,
): string {
  const ownerKey = useId();
  useCommandPalettePageCommands(
    actions.map((action) => ({
      id: action.id,
      label: action.label,
      target: { kind: "item" as const, key: ownerKey },
      focusRoot: () =>
        ownerSelector ? (root.current?.closest<HTMLElement>(ownerSelector) ?? null) : root.current,
      isVisible: () => root.current !== null && root.current.getClientRects().length > 0,
      ownsInput: action.ownsInput ?? false,
      disabledReason: () =>
        action.disabledReason ??
        (root.current?.matches(":disabled, [aria-disabled=true]")
          ? "This control is unavailable."
          : null),
      localOnly: action.localOnly ?? false,
      run: action.run,
    })),
  );
  return ownerKey;
}
