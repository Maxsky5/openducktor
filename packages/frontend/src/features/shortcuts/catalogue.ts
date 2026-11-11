import {
  BUILTIN_SHORTCUT_ACTIONS,
  builtinShortcutActionIdSchema,
  shortcutActionIdSchema,
  type ShortcutActionId,
  type AppPlatform,
  type ShortcutCombination,
  type ShortcutPreferences,
} from "@openducktor/contracts";
import {
  isShortcutKey,
  shortcutsOverlap,
  shortcutLabel,
} from "@openducktor/frontend-core/shortcuts/key-matching";
import { resolveTerminalKeyAction } from "@openducktor/frontend-core/terminals/terminal-keyboard-policy";

export type CommandContext =
  (typeof BUILTIN_SHORTCUT_ACTIONS)[keyof typeof BUILTIN_SHORTCUT_ACTIONS][2];
export type ShortcutCommandDefinition = {
  id: ShortcutActionId;
  label: string;
  group: string;
  context: CommandContext;
  allowInput: boolean;
  unavailableReason?: string;
};
export const SHORTCUT_COMMANDS: readonly ShortcutCommandDefinition[] =
  builtinShortcutActionIdSchema.options.map((id) => {
    const [label, group, context, allowInput] = BUILTIN_SHORTCUT_ACTIONS[id];
    return { id, label, group, context, allowInput };
  });
const commandsById = new Map(SHORTCUT_COMMANDS.map((command) => [command.id, command]));
export const commandDefinition = (id: ShortcutActionId): ShortcutCommandDefinition | undefined =>
  commandsById.get(id);
export const commandIdFromPalette = (id: string): ShortcutActionId | undefined =>
  shortcutActionIdSchema.safeParse(id.replace(/^action:(page:)?/, "")).data;
const defaultsFor = (platform: AppPlatform, electron: boolean) => {
  const mod = platform === "darwin" ? { meta: true } : { ctrl: true };
  const chord = (
    key: string,
    flags: Partial<Omit<ShortcutCombination, "key">>,
  ): ShortcutCombination => ({
    key: { kind: "logical", key },
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    ...flags,
  });
  const defaults = new Map<string, ShortcutCombination>(
    Object.entries({
      palette: chord("k", mod),
      "new-task": chord("o", { ctrl: true }),
      "new-chat": chord("o", { ctrl: true, shift: true }),
      settings: chord(",", { ctrl: true }),
      "focus-composer": chord("i", { ctrl: true }),
      sidebar: chord("b", { ctrl: true }),
      "bottom-panel": chord("j", mod),
      "right-panel": chord("l", mod),
      "new-bottom-tab": chord("enter", { ...mod, shift: true }),
      "new-right-tab": chord("enter", { ...mod, alt: true }),
      kanban: chord("g", { ctrl: true }),
      "focus-task-search": chord("f", mod),
      "task-edit": chord("e", mod),
      "close-panel-tab": electron ? chord("w", mod) : chord("x", { ctrl: true, shift: true }),
    }),
  );
  for (const [index, digit] of (
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const
  ).entries()) {
    for (const context of ["session", "workspace"] as const) {
      defaults.set(`${context}-position-${index + 1}`, {
        ...chord("", { ...mod, shift: context === "workspace" }),
        key: { kind: "number-row", digit },
      });
    }
  }
  return defaults;
};
const defaultShortcuts = {
  darwin: [defaultsFor("darwin", false), defaultsFor("darwin", true)],
  win32: [defaultsFor("win32", false), defaultsFor("win32", true)],
  linux: [defaultsFor("linux", false), defaultsFor("linux", true)],
};

export const defaultShortcut = (
  id: ShortcutActionId,
  platform: AppPlatform,
  electron: boolean,
): ShortcutCombination | null => defaultShortcuts[platform][electron ? 1 : 0]!.get(id) ?? null;

export const effectiveShortcut = (
  id: ShortcutActionId,
  preferences: ShortcutPreferences,
  platform: AppPlatform,
  electron: boolean,
): ShortcutCombination | null =>
  Object.hasOwn(preferences.overrides, id)
    ? preferences.overrides[id]!
    : defaultShortcut(id, platform, electron);
const INPUT_EXCEPTIONS = new Set([
  "palette",
  "focus-task-search",
  "sidebar",
  "focus-composer",
  "kanban",
  "new-task",
  "new-chat",
  "bottom-panel",
  "right-panel",
  "close-panel-tab",
]);
export const isApprovedInputException = (
  id: ShortcutActionId,
  combination: ShortcutCombination,
  platform: AppPlatform,
  electron: boolean,
): boolean => {
  const defaultValue = defaultShortcut(id, platform, electron);
  return (
    INPUT_EXCEPTIONS.has(id) && defaultValue !== null && shortcutsOverlap(defaultValue, combination)
  );
};
export const protectedInputReason = (
  id: ShortcutActionId,
  value: ShortcutCombination,
  platform: AppPlatform,
  electron: boolean,
): string | null => {
  if (isApprovedInputException(id, value, platform, electron)) return null;
  if (value.key.kind !== "logical") return null;
  const key = value.key.key.toLowerCase();
  const mod = platform === "darwin" ? value.meta : value.ctrl;
  if (
    platform === "darwin" &&
    value.alt &&
    [
      "arrowleft",
      "arrowright",
      "arrowup",
      "arrowdown",
      "backspace",
      "delete",
      "home",
      "end",
      "pageup",
      "pagedown",
    ].includes(key)
  )
    return "native editing and selection";
  if (
    mod &&
    [
      "a",
      "c",
      "x",
      "v",
      "z",
      "y",
      "arrowleft",
      "arrowright",
      "arrowup",
      "arrowdown",
      "backspace",
      "delete",
      "home",
      "end",
    ].includes(key)
  )
    return "native editing and selection";
  if (key === "enter" && !value.alt && !value.shift) return "message submission";
  const terminalEvent = {
    key,
    type: "keydown",
    ctrlKey: value.ctrl,
    metaKey: value.meta,
    altKey: value.alt,
    shiftKey: value.shift,
  };
  if (
    (["darwin", "linux", "win32"] as const).some((hostPlatform) =>
      [false, true].some(
        (selection) =>
          resolveTerminalKeyAction(terminalEvent, hostPlatform, selection).type !== "passthrough",
      ),
    )
  )
    return "terminal copy, paste or line editing";
  if (
    value.ctrl &&
    !value.meta &&
    !value.alt &&
    [
      "a",
      "b",
      "d",
      "e",
      "f",
      "g",
      "h",
      "i",
      "j",
      "k",
      "l",
      "m",
      "n",
      "o",
      "p",
      "t",
      "u",
      "v",
      "w",
      "y",
    ].includes(key)
  )
    return "Control-key editing";
  return null;
};
const WINDOWS_SHELL_KEYS = new Set([
  "l",
  "d",
  "e",
  "r",
  "tab",
  " ",
  "arrowleft",
  "arrowright",
  "arrowup",
  "arrowdown",
]);
export const validateShortcuts = (
  preferences: ShortcutPreferences,
  platform: AppPlatform,
  electron: boolean,
  definitions: readonly ShortcutCommandDefinition[] = SHORTCUT_COMMANDS,
): string | null => {
  const assigned: { command: ShortcutCommandDefinition; value: ShortcutCombination }[] = [];
  for (const command of definitions) {
    if (command.unavailableReason) continue;
    const value = effectiveShortcut(command.id, preferences, platform, electron);
    if (!value) continue;
    if (value.key.kind === "logical" && !isShortcutKey(value.key.key))
      return `${command.label}: unsupported key ${value.key.key}.`;
    const key = value.key.kind === "logical" ? value.key.key.toLowerCase() : null;
    if (
      platform !== "darwin" &&
      value.ctrl &&
      value.alt &&
      (value.key.kind === "number-row" || (key !== null && Array.from(key).length === 1))
    )
      return `${command.label}: Control+Alt printable keys are reserved for AltGr. Choose another combination.`;
    const mod = platform === "darwin" ? value.meta : value.ctrl;
    if (
      key &&
      ((!electron && mod && ["w", "t", "n"].includes(key)) ||
        (platform === "darwin" && value.meta && ["tab", " "].includes(key)) ||
        (platform !== "darwin" && value.alt && key === "tab") ||
        (platform !== "darwin" && value.ctrl && value.alt && key === "delete") ||
        (platform === "win32" && value.meta && WINDOWS_SHELL_KEYS.has(key)) ||
        (value.alt && key === "f4") ||
        (mod && key === "q"))
    )
      return `${command.label}: ${shortcutLabel(value, platform)} is reserved by the shell.`;
    const protectedReason = protectedInputReason(command.id, value, platform, electron);
    if (
      protectedReason &&
      (command.allowInput ||
        protectedReason === "native editing and selection" ||
        protectedReason === "message submission")
    )
      return `${command.label}: ${shortcutLabel(value, platform)} is reserved for ${protectedReason}.`;
    const conflict = assigned.find(
      (other) =>
        shortcutsOverlap(other.value, value) &&
        !(
          [command.context, other.command.context].includes("task") &&
          [command.context, other.command.context].includes("chat")
        ),
    );
    if (conflict) return `${command.label}: conflicts with ${conflict.command.label}.`;
    assigned.push({ command, value });
  }
  return null;
};
