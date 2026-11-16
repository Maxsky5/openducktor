import type { CommandPalettePageCommand } from "../command-palette/command-palette-types";
import { isUnlisted } from "../command-palette/command-palette-registry";
import { parseWorkflowShortcutActionId, type ShortcutActionId } from "@openducktor/contracts";
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

/** Focus is in an editor, a terminal, a visited page or an embedded guest, outside the palette. */
export const isTyping = (focus: Element | null, embedded: boolean, palette: boolean): boolean =>
  embedded || (!palette && isProtectedFocus(focus));

const NO_COMMANDS: readonly CommandPalettePageCommand[] = [];
/** The registered commands by id, built once for each registry snapshot. */
const commandIndexes = new WeakMap<
  readonly CommandPalettePageCommand[],
  Map<ShortcutActionId, CommandPalettePageCommand[]>
>();
const commandsWithId = (
  commands: readonly CommandPalettePageCommand[],
  id: ShortcutActionId,
): readonly CommandPalettePageCommand[] => {
  let index = commandIndexes.get(commands);
  if (!index) {
    index = new Map();
    for (const command of commands) {
      const same = index.get(command.id);
      if (same) same.push(command);
      else index.set(command.id, [command]);
    }
    commandIndexes.set(commands, index);
  }
  return index.get(id) ?? NO_COMMANDS;
};

/**
 * A command has one eligible owner. Ambiguous owners never depend on registration order. While
 * the user types, only a command that runs during typing, or the control that owns the input,
 * can own the keys.
 */
export const resolvePageCommand = (
  commands: readonly CommandPalettePageCommand[],
  definition: ShortcutCommandDefinition,
  focus: Element | null,
  { palette, typing }: { palette: boolean; typing: boolean },
): CommandPalettePageCommand | null => {
  const blockedByTyping = typing && definition.when !== "always";
  const candidates = commandsWithId(commands, definition.id).filter((command) => {
    if (command.paletteOnly && !palette) return false;
    if (blockedByTyping && !command.ownsInput) return false;
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
  /** From `isTyping`, computed once for every binding of one key press or label pass. */
  typing: boolean;
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
  const owner = resolvePageCommand(context.commands, definition, context.focus, {
    palette: context.paletteOpen,
    typing: context.typing,
  });
  if (!owner) return null;
  if (
    context.overlayOpen &&
    !context.paletteOpen &&
    !owner.focusRoot?.()?.closest('[role="dialog"], [role="alertdialog"]')
  )
    return null;
  return owner;
};

/** The catalogue definition of a registration; a workflow action is defined by its host. */
const definitionOf = (command: CommandPalettePageCommand): ShortcutCommandDefinition => {
  const builtin = commandDefinition(command.id);
  if (builtin) return builtin;
  const workflow = parseWorkflowShortcutActionId(command.id);
  if (!workflow) throw new Error(`Shortcut action ${command.id} is not a known command.`);
  return workflowCommandDefinition(command.id, workflow.workflowId, command.label);
};

/** Runs the one eligible owner of a command outside the palette, such as from a menu. */
export const runRegisteredCommand = (
  commands: readonly CommandPalettePageCommand[],
  id: ShortcutActionId,
  focus: Element | null,
): void => {
  const definition = commandDefinition(id);
  const command = definition
    ? resolvePageCommand(commands, definition, focus, {
        palette: false,
        typing: isTyping(focus, false, false),
      })
    : null;
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
  const listed = commands.filter((command) => !isUnlisted(command));
  const owners = new Map<ShortcutActionId, CommandPalettePageCommand | null>();
  for (const command of listed) {
    if (owners.has(command.id)) continue;
    owners.set(
      command.id,
      resolvePageCommand(listed, definitionOf(command), focus, { palette: true, typing: false }),
    );
  }
  return listed.filter((command) => owners.get(command.id) === command);
};
