import type { CommandPalettePageCommand } from "../command-palette/command-palette-types";
import type { ShortcutActionId } from "@openducktor/contracts";
import {
  commandDefinition,
  runsInPalette,
  type ShortcutCommandDefinition,
  workflowCommandDefinition,
} from "./catalogue";
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
  definition: ShortcutCommandDefinition,
  focus: Element | null,
  palette: boolean,
): CommandPalettePageCommand | null => {
  const protectedFocus = !palette && !definition.allowInput && isProtectedFocus(focus);
  const candidates = commands.filter((command) => {
    if (command.id !== definition.id || (command.paletteOnly && !palette)) return false;
    if (protectedFocus && !command.ownsInput) return false;
    const root = command.focusRoot?.();
    if (command.focusRoot && (!root?.isConnected || !shortcutFocusWithin(root, focus)))
      return false;
    if (!isVisibleCommand(command)) return false;
    return definition.scope.kind !== "focus" || Boolean(root);
  });
  // A page owner of an app command, such as the sidebar's Kanban link, comes before the app owner.
  const pageOwners = candidates.filter((command) => !command.appWide);
  if (pageOwners.length > 0 && pageOwners.length < candidates.length)
    return resolveAmong(pageOwners, focus, palette);
  return resolveAmong(candidates, focus, palette);
};

const resolveAmong = (
  candidates: readonly CommandPalettePageCommand[],
  focus: Element | null,
  palette: boolean,
): CommandPalettePageCommand | null => {
  const highlighted = candidates.filter((command) => command.paletteOnly);
  if (palette && highlighted.length === 1) return highlighted[0]!;
  if (candidates.length === 1) return candidates[0]!;
  const focused = candidates.filter((command) => {
    const root = command.focusRoot?.();
    return root && shortcutFocusWithin(root, focus);
  });
  return focused.length === 1 ? focused[0]! : null;
};

export type ShortcutContext = {
  commands: readonly CommandPalettePageCommand[];
  focus: Element | null;
  /** Focus is in a browser guest or a preview frame, which counts as typing. */
  embedded: boolean;
  paletteOpen: boolean;
  /** A dialog other than the palette is open. */
  overlayOpen: boolean;
};

/**
 * The registered owner that a shortcut runs now, or null when the command is not eligible. The
 * palette toggle has no owner; its caller handles it.
 */
export const resolveShortcutOwner = (
  definition: ShortcutCommandDefinition,
  context: ShortcutContext,
): CommandPalettePageCommand | null => {
  if (context.paletteOpen && !runsInPalette(definition)) return null;
  const owner = resolvePageCommand(
    context.commands,
    definition,
    context.focus,
    context.paletteOpen,
  );
  if (!owner) return null;
  if (
    context.overlayOpen &&
    !context.paletteOpen &&
    !owner.focusRoot?.()?.closest('[role="dialog"], [role="alertdialog"]')
  )
    return null;
  const typing = context.embedded || (!context.paletteOpen && isProtectedFocus(context.focus));
  if (typing && !definition.allowInput && !owner.ownsInput) return null;
  return owner;
};

/** The catalogue definition of a registration; a workflow action is defined by its host. */
const definitionOf = (command: CommandPalettePageCommand): ShortcutCommandDefinition =>
  commandDefinition(command.id) ?? workflowCommandDefinition(command.id, "", command.label);

/** Runs the one eligible owner of a command outside the palette, such as from a menu. */
export const runRegisteredCommand = (
  commands: readonly CommandPalettePageCommand[],
  id: ShortcutActionId,
  focus: Element | null,
): void => {
  const definition = commandDefinition(id);
  const command = definition ? resolvePageCommand(commands, definition, focus, false) : null;
  const run = command?.resolveRun ? command.resolveRun() : command?.run;
  run?.();
};

/** The page commands that the open palette lists: one resolved owner for each command. */
export const paletteCommandsFor = (
  commands: readonly CommandPalettePageCommand[],
  focus: Element | null,
): CommandPalettePageCommand[] => {
  // The highlighted record's commands only serve its shortcuts. Listing them would move the
  // highlight, which removes them again, so the list and the registry would never settle.
  const listed = commands.filter((command) => !command.paletteOnly && !command.localOnly);
  const owners = new Map<ShortcutActionId, CommandPalettePageCommand | null>();
  for (const command of listed) {
    if (owners.has(command.id)) continue;
    owners.set(command.id, resolvePageCommand(listed, definitionOf(command), focus, true));
  }
  return listed.filter((command) => owners.get(command.id) === command);
};
