import type { ShortcutActionId } from "@openducktor/contracts";
import type { CommandPalettePageCommand } from "../command-palette/command-palette-types";
import { commandDefinition } from "./catalogue";
import { shortcutFocusWithin } from "./shortcut-focus";

export const isVisibleCommand = (command: CommandPalettePageCommand): boolean =>
  command.isVisible?.() !== false && !command.disabledReason?.();
export const isProtectedFocus = (focus: Element | null): boolean =>
  focus instanceof HTMLElement &&
  (focus.isContentEditable ||
    Boolean(
      focus.closest('input, textarea, [role="textbox"], .xterm, iframe, [data-visited-page]'),
    ));
/** A command has one eligible owner. Ambiguous owners never depend on registration order. */
export const resolvePageCommand = (
  commands: readonly CommandPalettePageCommand[],
  id: ShortcutActionId,
  focus: Element | null,
  palette: boolean,
): CommandPalettePageCommand | null => {
  const definition = commandDefinition(id);
  const protectedFocus = !palette && !definition?.allowInput && isProtectedFocus(focus);

  const candidates = commands.filter((command) => {
    if (command.id !== id || (command.paletteOnly && !palette)) return false;
    if (protectedFocus && !command.ownsInput) return false;
    const root = command.focusRoot?.();
    if (command.focusRoot && (!root?.isConnected || !shortcutFocusWithin(root, focus)))
      return false;
    if (!isVisibleCommand(command)) return false;
    if (definition?.context === "panel" || definition?.context === "item") return Boolean(root);
    return true;
  });
  const highlighted = candidates.filter((command) => command.paletteOnly);
  if (palette && highlighted.length === 1) return highlighted[0]!;
  if (candidates.length === 1) return candidates[0]!;
  const focused = candidates.filter((command) => {
    const root = command.focusRoot?.();
    return root && shortcutFocusWithin(root, focus);
  });
  return focused.length === 1 ? focused[0]! : null;
};
