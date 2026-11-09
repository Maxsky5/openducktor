import { CommandPaletteRegistryContext } from "./command-palette-registry";
import { Command } from "lucide-react";
import { commandDefinition } from "../shortcuts/catalogue";
import type { AppPlatform, ShortcutActionId } from "@openducktor/contracts";
import { createContext, use, useEffect, useLayoutEffect, useRef } from "react";
import type {
  CommandPalettePageCommand,
  CommandPaletteCommandRegistration,
} from "./command-palette-types";

export type CommandPaletteContextValue = {
  open: () => void;
  runPageCommand?: (id: ShortcutActionId) => void;
  /** Add a command while the page is mounted. The returned function removes it. */
  registerPageCommand: (command: CommandPalettePageCommand) => () => void;
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
        command.disabledReason?.() ?? null,
      ]),
    );
    const changed = previous.current !== null && previous.current !== snapshot;
    previous.current = snapshot;
    if (changed) invalidate?.();
  });
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
  const signature = JSON.stringify(
    commands.map((command) => [command.id, command.target?.key, command.label]),
  );
  useEffect(() => {
    if (!registerPageCommand) return;
    const releases = latest.current.map((command, index) => {
      const { id } = command;
      const targetKey = command.target?.key;
      const label = command.label ?? commandDefinition(command.id)?.label;
      if (!label) throw new Error(`Shortcut action ${command.id} has no label.`);
      return registerPageCommand({
        ...command,
        label,
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
