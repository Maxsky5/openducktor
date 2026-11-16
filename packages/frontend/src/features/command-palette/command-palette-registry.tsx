import { createContext, type PropsWithChildren, use, useState, useSyncExternalStore } from "react";
import type { CommandPalettePageCommand } from "./command-palette-types";
import { createShortcutLabelStore } from "../shortcuts/shortcut-label-store";

type CommandPaletteRegistry = {
  readonly pageCommands: readonly CommandPalettePageCommand[];
  /**
   * The commands that the palette can list: no palette-only or local-only command. It keeps its
   * identity while only those change, such as the highlighted record's commands on each key.
   */
  readonly listedCommands: readonly CommandPalettePageCommand[];
  subscribe(listener: () => void): () => void;
  registerPageCommand(command: CommandPalettePageCommand): () => void;
  /** `unlisted` is true when only commands that the palette never lists changed. */
  invalidatePageCommands(unlisted: boolean): void;
  shortcutLabels: ReturnType<typeof createShortcutLabelStore>;
};

export const CommandPaletteRegistryContext = createContext<CommandPaletteRegistry | null>(null);
const emptyCommands: readonly CommandPalettePageCommand[] = [];
const emptySnapshot = () => emptyCommands;
const noSubscription = () => () => {};
/** The palette never lists the highlighted record's commands or a local control's commands. */
export const isUnlisted = (command: { paletteOnly?: boolean; localOnly?: boolean }) =>
  command.paletteOnly === true || command.localOnly === true;

export function useCommandPaletteCommands(
  enabled = true,
  which: "all" | "listed" = "all",
): readonly CommandPalettePageCommand[] {
  const registry = use(CommandPaletteRegistryContext);
  return useSyncExternalStore(
    enabled ? (registry?.subscribe ?? noSubscription) : noSubscription,
    enabled && registry
      ? () => (which === "listed" ? registry.listedCommands : registry.pageCommands)
      : emptySnapshot,
    emptySnapshot,
  );
}

/** Command readers subscribe without rerendering registration owners. */
export function CommandPaletteRegistryProvider({ children }: PropsWithChildren) {
  const [registry] = useState<CommandPaletteRegistry>(() => {
    const commands = new Set<CommandPalettePageCommand>();
    let snapshot: readonly CommandPalettePageCommand[] | null = null;
    let listed: readonly CommandPalettePageCommand[] | null = null;
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
    const changed = (unlisted: boolean) => {
      snapshot = null;
      if (!unlisted) listed = null;
      notify();
    };
    return {
      get pageCommands() {
        return (snapshot ??= [...commands]);
      },
      get listedCommands() {
        return (listed ??= [...commands].filter((command) => !isUnlisted(command)));
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      registerPageCommand(command) {
        const unlisted = isUnlisted(command);
        commands.add(command);
        changed(unlisted);
        return () => {
          commands.delete(command);
          changed(unlisted);
        };
      },
      invalidatePageCommands: changed,
      shortcutLabels: createShortcutLabelStore(),
    };
  });
  return <CommandPaletteRegistryContext value={registry}>{children}</CommandPaletteRegistryContext>;
}
