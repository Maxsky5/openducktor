import { SHORTCUT_POSITIONS } from "@openducktor/contracts";
import { PanelLeftOpen } from "lucide-react";
import type { SessionNavigationEntry } from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";
import { sessionNavigationTargetKey } from "@openducktor/frontend-core/sessions/navigation/session-navigation-target";
import { useVisibleSessionControls } from "@openducktor/frontend-core/sessions/navigation/visible-session-target";
import { useCommandPalettePageCommands } from "../command-palette/command-palette-context";

export function useSessionNavigationShortcuts({
  numberedEntries,
  cyclingEntries,
  listScopeKey,
  openEntry,
}: {
  numberedEntries: readonly SessionNavigationEntry[];
  cyclingEntries: readonly SessionNavigationEntry[];
  listScopeKey: string;
  openEntry(entry: SessionNavigationEntry): void;
}) {
  const { readVisible } = useVisibleSessionControls();
  useCommandPalettePageCommands([
    ...SHORTCUT_POSITIONS.map((position, index) => ({
      id: `session-position-${position}` as const,
      icon: PanelLeftOpen,
      keywords: ["session", "position"],
      target: { kind: "workspace" as const, key: listScopeKey },
      run: () => {
        const entry = numberedEntries[index];
        if (entry) openEntry(entry);
      },
    })),
    ...(["previous", "next"] as const).map((direction) => ({
      id: `session-${direction}` as const,
      icon: PanelLeftOpen,
      keywords: ["navigate", "session"],
      target: { kind: "workspace" as const, key: listScopeKey },
      run: () => {
        const visible = readVisible();
        const index = cyclingEntries.findIndex(
          (entry) =>
            visible &&
            sessionNavigationTargetKey(entry.target) === sessionNavigationTargetKey(visible.target),
        );
        const selected =
          index < 0
            ? direction === "next"
              ? 0
              : cyclingEntries.length - 1
            : (index + (direction === "next" ? 1 : -1) + cyclingEntries.length) %
              cyclingEntries.length;
        const entry = cyclingEntries[selected];
        if (entry) openEntry(entry);
      },
    })),
  ]);
}
