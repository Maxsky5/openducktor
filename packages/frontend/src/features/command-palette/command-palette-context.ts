import { CommandPaletteRegistryContext, isUnlisted } from "./command-palette-registry-context";
import { Command } from "lucide-react";
import { commandDefinition } from "../shortcuts/catalogue";
import type { AppPlatform, ShortcutActionId } from "@openducktor/contracts";
import { createContext, use, useEffect, useLayoutEffect, useRef } from "react";
import type { CommandPaletteCommandRegistration } from "./command-palette-types";

export type CommandPaletteContextValue = {
  open: () => void;
  runPageCommand?: (id: ShortcutActionId) => void;
  /** Add a command while the page is mounted. The returned function removes it. */
  /** The platform of this device. Key caps depend on it. */
  platform: AppPlatform | null;
};

export const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export function useCommandPalette(): CommandPaletteContextValue {
  const value = use(CommandPaletteContext);
  if (!value) throw new Error("useCommandPalette must be used inside CommandPaletteProvider.");
  return value;
}

/** Publish committed availability changes to native and preview input owners. */
function useCommandAvailability(commands: readonly CommandPaletteCommandRegistration[]): void {
  const invalidate = use(CommandPaletteRegistryContext)?.invalidatePageCommands;
  const previous = useRef<string | null>(null);
  useLayoutEffect(() => {
    const snapshot = JSON.stringify(
      commands.map((command) => [
        command.id,
        command.target?.key,
        command.label,
        command.disabledReason?.() ?? null,
      ]),
    );
    const changed = previous.current !== null && previous.current !== snapshot;
    previous.current = snapshot;
    if (changed) invalidate?.(commands.every(isUnlisted));
    // A caller that memoizes its commands skips this work while they stay the same; their
    // availability closures then read the same values.
  }, [commands, invalidate]);
}

/** Keep a page command in the palette while the calling page is mounted. */
export function useCommandPalettePageCommand(
  command: CommandPaletteCommandRegistration | null,
): void {
  useCommandPalettePageCommands(command ? [command] : []);
}

export function useCommandPalettePageCommands(
  commands: readonly CommandPaletteCommandRegistration[],
): void {
  const registerPageCommand = use(CommandPaletteRegistryContext)?.registerPageCommand;
  const latest = useRef(commands);
  useLayoutEffect(() => {
    latest.current = commands;
  });
  useCommandAvailability(commands);
  // A label change, such as "Hide sidebar" to "Show sidebar", is read live below and published as
  // an availability change, so it does not register every command of the caller again.
  const signature = JSON.stringify(commands.map((command) => [command.id, command.target?.key]));
  useEffect(() => {
    if (!registerPageCommand) return;
    const releases = latest.current.map((command, index) => {
      const { id } = command;
      const targetKey = command.target?.key;
      const labelOf = (current: CommandPaletteCommandRegistration) =>
        current.label ?? commandDefinition(current.id)?.label;
      const label = labelOf(command);
      if (!label) throw new Error(`Shortcut action ${command.id} has no label.`);
      return registerPageCommand({
        ...command,
        get label() {
          const current = latest.current[index];
          return (current?.id === id && labelOf(current)) || label;
        },
        icon: command.icon ?? Command,
        keywords: command.keywords ?? [label],
        resolveRun: () => {
          const current = latest.current[index];
          return current?.id === id && current.target?.key === targetKey ? current.run : null;
        },
        run: () => {
          const current = latest.current[index];
          if (current?.id === id && current.target?.key === targetKey) current.run();
        },
        focusRoot: command.focusRoot
          ? () => latest.current[index]?.focusRoot?.() ?? null
          : undefined,
        isVisible: () =>
          latest.current[index]?.id === id &&
          latest.current[index]?.target?.key === targetKey &&
          latest.current[index]?.isVisible?.() !== false,
        disabledReason: () => latest.current[index]?.disabledReason?.() ?? null,
      });
    });
    return () => releases.forEach((release) => release());
  }, [signature, registerPageCommand]);
}
