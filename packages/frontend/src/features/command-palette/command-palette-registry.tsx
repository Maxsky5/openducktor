import { type PropsWithChildren, useState } from "react";
import type { CommandPalettePageCommand } from "./command-palette-types";
import { createShortcutLabelStore } from "../shortcuts/shortcut-label-store";
import {
  type CommandPaletteRegistry,
  CommandPaletteRegistryContext,
  isUnlisted,
} from "./command-palette-registry-context";

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
