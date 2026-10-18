import type { AppPlatform } from "@openducktor/contracts";
import { createContext, use, useEffect } from "react";
import type { CommandPalettePageCommand } from "./command-palette-types";

export type CommandPaletteContextValue = {
  open: () => void;
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

/** Keep a page command in the palette while the calling page is mounted. */
export function useCommandPalettePageCommand(command: CommandPalettePageCommand | null): void {
  const { registerPageCommand } = useCommandPalette();
  useEffect(
    () => (command ? registerPageCommand(command) : undefined),
    [command, registerPageCommand],
  );
}
