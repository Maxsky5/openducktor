import {
  type AppPlatform,
  isShortcutKey,
  resolveShortcutModifiers,
  sameShortcut,
  type ShortcutActionId,
  type ShortcutCombination,
  type ShortcutPreferences,
  shortcutSignature,
} from "@openducktor/contracts";
import { shortcutLabel } from "@openducktor/frontend-core/shortcuts/key-labels";
import { resolveTerminalKeyAction } from "@openducktor/frontend-core/terminals/terminal-keyboard-policy";
import {
  effectiveShortcut,
  scopesCanCoexist,
  type ShortcutCommandDefinition,
  type ShortcutShell,
  withWhen,
} from "./catalogue";

/*
 * Device compilation: which assignments run on one platform and shell, and why the others do not.
 */

type DeviceKeys = { key: string; ctrl: boolean; meta: boolean; alt: boolean; shift: boolean };

const EDITING_KEYS = ["arrowleft", "arrowright", "arrowup", "arrowdown", "backspace", "delete"];
const CONTROL_EDITING_LETTERS = "abdefghijklmnoptuvwy";

/** Why keys are protected while the user types; `text` completes "reserved for …". */
type ProtectedInput = {
  kind: "editing" | "submit" | "terminal" | "control-letter";
  text: string;
};

const protectedInputReason = (keys: DeviceKeys, platform: AppPlatform): ProtectedInput | null => {
  const { key, ctrl, meta, alt, shift } = keys;
  const mod = platform === "darwin" ? meta : ctrl;
  if (
    platform === "darwin" &&
    alt &&
    [...EDITING_KEYS, "home", "end", "pageup", "pagedown"].includes(key)
  )
    return { kind: "editing", text: "native editing and selection" };
  if (mod && ["a", "c", "x", "v", "z", "y", ...EDITING_KEYS, "home", "end"].includes(key))
    return { kind: "editing", text: "native editing and selection" };
  if (key === "enter" && !alt && !shift) return { kind: "submit", text: "message submission" };
  const terminalEvent = {
    key,
    type: "keydown",
    ctrlKey: ctrl,
    metaKey: meta,
    altKey: alt,
    shiftKey: shift,
  };
  if (
    (["darwin", "linux", "win32"] as const).some((hostPlatform) =>
      [false, true].some(
        (selection) =>
          resolveTerminalKeyAction(terminalEvent, hostPlatform, selection).type !== "passthrough",
      ),
    )
  )
    return { kind: "terminal", text: "terminal copy, paste or line editing" };
  if (ctrl && !meta && !alt && key.length === 1 && CONTROL_EDITING_LETTERS.includes(key))
    return { kind: "control-letter", text: "Control-key editing" };
  return null;
};

const shellReserved = (keys: DeviceKeys, platform: AppPlatform, shell: ShortcutShell): boolean => {
  const { key, ctrl, meta, alt } = keys;
  const mod = platform === "darwin" ? meta : ctrl;
  return (
    (shell === "browser" && mod && ["w", "t", "n"].includes(key)) ||
    (platform === "darwin" && meta && ["tab", " "].includes(key)) ||
    (platform !== "darwin" && alt && key === "tab") ||
    (platform !== "darwin" && ctrl && alt && key === "delete") ||
    (alt && key === "f4") ||
    (mod && key === "q")
  );
};

/**
 * Why an assignment cannot run on a device. `conflict` names the other command of a key conflict:
 * the command that keeps the keys in `problems`, and the command that loses them in the result of
 * `problemOfCommand`.
 */
export type ShortcutProblem = {
  commandId: ShortcutActionId;
  message: string;
  conflict?: ShortcutCommandDefinition;
};
export type ShortcutBinding = {
  command: ShortcutCommandDefinition;
  combination: ShortcutCombination;
  signature: string;
};
export type CompiledShortcuts = {
  /** Active bindings by device signature. One signature has several only in exclusive scopes. */
  bySignature: ReadonlyMap<string, readonly ShortcutBinding[]>;
  byId: ReadonlyMap<ShortcutActionId, ShortcutBinding>;
  /** Assignments that cannot run on this device. Other assignments stay active. */
  problems: ReadonlyMap<ShortcutActionId, ShortcutProblem>;
};

const problemOf = (
  command: ShortcutCommandDefinition,
  combination: ShortcutCombination,
  platform: AppPlatform,
  shell: ShortcutShell,
): string | null => {
  const label = shortcutLabel(combination, platform);
  if (combination.key.kind === "logical" && !isShortcutKey(combination.key.key))
    return `${combination.key.key} is not a supported key.`;
  const resolved = resolveShortcutModifiers(combination, platform);
  const key = combination.key.kind === "logical" ? combination.key.key.toLowerCase() : "";
  const printable = combination.key.kind === "number-row" || Array.from(key).length === 1;
  if (platform !== "darwin" && resolved.ctrl && resolved.alt && printable)
    return `${label} types characters with AltGr on this keyboard.`;
  const keys = { key, ...resolved };
  if (shellReserved(keys, platform, shell))
    return `${label} is reserved by the ${shell === "browser" ? "browser" : "system"}.`;
  // The specification approves only the default keys of a command that runs while typing by default.
  const runsWhileTyping = command.when === "always";
  const approvedException =
    runsWhileTyping &&
    command.defaultWhen === "always" &&
    sameShortcut(combination, command.defaultKeys[shell]);
  const reason = approvedException ? null : protectedInputReason(keys, platform);
  // Editing and submission keys stay protected everywhere; the others only while typing.
  if (reason && (runsWhileTyping || reason.kind === "editing" || reason.kind === "submit"))
    return `${label} is reserved for ${reason.text}.`;
  return null;
};

/**
 * The active bindings of one device. An assignment that cannot run here, or that overlaps an
 * earlier coexisting binding, is inactive only on this device and reports its problem.
 */
export const compileShortcuts = (
  preferences: ShortcutPreferences,
  catalogue: readonly ShortcutCommandDefinition[],
  platform: AppPlatform,
  shell: ShortcutShell,
): CompiledShortcuts => {
  const bySignature = new Map<string, ShortcutBinding[]>();
  const byId = new Map<ShortcutActionId, ShortcutBinding>();
  const problems = new Map<ShortcutActionId, ShortcutProblem>();
  for (const entry of catalogue) {
    if (entry.unavailableReason) continue;
    const command = withWhen(entry, preferences);
    const combination = effectiveShortcut(command, preferences, shell);
    if (!combination) continue;
    const message = problemOf(command, combination, platform, shell);
    if (message) {
      problems.set(command.id, { commandId: command.id, message });
      continue;
    }
    const signature = shortcutSignature(combination, platform);
    const shared = bySignature.get(signature) ?? [];
    const conflict = shared.find((other) => scopesCanCoexist(other.command.scope, command.scope));
    if (conflict) {
      problems.set(command.id, {
        commandId: command.id,
        message: `${shortcutLabel(combination, platform)} is used by ${conflict.command.label}.`,
        conflict: conflict.command,
      });
      continue;
    }
    const binding = { command, combination, signature };
    shared.push(binding);
    bySignature.set(signature, shared);
    byId.set(command.id, binding);
  }
  return { bySignature, byId, problems };
};

/**
 * The problem that an assignment causes on a device: its own, or the problem of a command that
 * loses its keys to it. `conflict` then names that other command.
 */
export const problemOfCommand = (
  compiled: CompiledShortcuts,
  catalogue: readonly ShortcutCommandDefinition[],
  id: ShortcutActionId,
): ShortcutProblem | null => {
  const own = compiled.problems.get(id);
  if (own) return own;
  const lost = Array.from(compiled.problems.values()).find(
    (problem) => problem.conflict?.id === id,
  );
  if (!lost) return null;
  const loser = catalogue.find((command) => command.id === lost.commandId);
  return loser ? { commandId: id, message: lost.message, conflict: loser } : lost;
};

const DEVICES = [
  ["darwin", "macOS"],
  ["win32", "Windows"],
  ["linux", "Linux"],
] as const;
/**
 * The other devices where a command would be inactive, such as "on Windows" when it fails in both
 * apps there, or "in the browser on Linux".
 */
export const otherDeviceProblems = (
  preferences: ShortcutPreferences,
  catalogue: readonly ShortcutCommandDefinition[],
  id: ShortcutActionId,
  current: { platform: AppPlatform; shell: ShortcutShell },
): string[] =>
  DEVICES.flatMap(([platform, name]) => {
    const failing = (["electron", "browser"] as const).filter(
      (shell) =>
        (platform !== current.platform || shell !== current.shell) &&
        problemOfCommand(compileShortcuts(preferences, catalogue, platform, shell), catalogue, id),
    );
    if (failing.length === 2) return [`on ${name}`];
    return failing.map(
      (shell) => `in ${shell === "electron" ? "the desktop app" : "the browser"} on ${name}`,
    );
  });
