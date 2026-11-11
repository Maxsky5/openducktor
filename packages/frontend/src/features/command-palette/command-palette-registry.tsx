import { createContext, type PropsWithChildren, use, useState, useSyncExternalStore } from "react";
import type { CommandPalettePageCommand } from "./command-palette-types";
import { createShortcutLabelStore } from "../shortcuts/shortcut-label-store";

type CommandPaletteRegistry = {
  readonly pageCommands: readonly CommandPalettePageCommand[];
  subscribe(listener: () => void): () => void;
  registerPageCommand(command: CommandPalettePageCommand): () => void;
  invalidatePageCommands(): void;
  shortcutLabels?: ReturnType<typeof createShortcutLabelStore>;
};

export const CommandPaletteRegistryContext = createContext<CommandPaletteRegistry | null>(null);
const emptyCommands: readonly CommandPalettePageCommand[] = [];
const emptySnapshot = () => emptyCommands;
const noSubscription = () => () => {};

export function useCommandPaletteCommands(enabled = true): readonly CommandPalettePageCommand[] {
  const registry = use(CommandPaletteRegistryContext);
  return useSyncExternalStore(
    enabled ? (registry?.subscribe ?? noSubscription) : noSubscription,
    enabled && registry ? () => registry.pageCommands : emptySnapshot,
    emptySnapshot,
  );
}

/** Command readers subscribe without rerendering registration owners. */
export function CommandPaletteRegistryProvider({ children }: PropsWithChildren) {
  const [registry] = useState<CommandPaletteRegistry>(() => {
    const commands = new Set<CommandPalettePageCommand>();
    let snapshot: readonly CommandPalettePageCommand[] | null = null;
    const listeners = new Set<() => void>();
    let pending = false;
    const notify = () => {
      if (pending) return;
      pending = true;
      queueMicrotask(() => {
        pending = false;
        for (const listener of listeners) listener();
      });
    };
    return {
      get pageCommands() {
        return (snapshot ??= [...commands]);
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      registerPageCommand(command) {
        commands.add(command);
        snapshot = null;
        notify();
        return () => {
          commands.delete(command);
          snapshot = null;
          notify();
        };
      },
      invalidatePageCommands() {
        snapshot = null;
        notify();
      },
      shortcutLabels: createShortcutLabelStore(),
    };
  });
  return <CommandPaletteRegistryContext value={registry}>{children}</CommandPaletteRegistryContext>;
}
