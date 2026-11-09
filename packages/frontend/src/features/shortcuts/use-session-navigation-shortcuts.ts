import { SHORTCUT_POSITIONS } from "@openducktor/contracts";
import { useMemo, useState } from "react";
import { PanelLeftOpen } from "lucide-react";
import type {
  SessionNavigationEntry,
  SessionNavigationGroup,
} from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";
import { sessionNavigationTargetKey } from "@openducktor/frontend-core/sessions/navigation/session-navigation-target";
import { useVisibleSessionControls } from "@openducktor/frontend-core/sessions/navigation/visible-session-target";
import { useCommandPalettePageCommands } from "../command-palette/command-palette-context";

export function useSessionNavigationShortcuts({
  groups,
  listScopeKey,
  openEntry,
}: {
  groups: readonly SessionNavigationGroup[];
  listScopeKey: string;
  openEntry(entry: SessionNavigationEntry): void;
}) {
  const { readVisible } = useVisibleSessionControls();
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());
  const { scopedCollapsed, numberedEntries, cyclingEntries, positions } = useMemo(() => {
    const scopedCollapsed = new Set(
      groups
        .filter((group) => collapsedGroups.has(`${listScopeKey}:${group.id}`))
        .map((group) => group.id),
    );
    const numberedEntries = groups
      .filter((group) => !scopedCollapsed.has(group.id))
      .flatMap((group) => group.entries);
    return {
      scopedCollapsed,
      numberedEntries,
      cyclingEntries: groups.flatMap((group) => group.entries),
      positions: new Map(numberedEntries.map((entry, index) => [entry.key, index + 1])),
    };
  }, [groups, collapsedGroups, listScopeKey]);
  const toggleGroup = (id: string) =>
    setCollapsedGroups((current) => {
      const next = new Set(current);
      const key = `${listScopeKey}:${id}`;
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  useCommandPalettePageCommands([
    ...SHORTCUT_POSITIONS.map((position, index) => ({
      id: `session-position-${position}` as const,
      label: `Select session at position ${index + 1}`,
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
      label: `${direction === "previous" ? "Previous" : "Next"} session`,
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
  return { scopedCollapsed, positions, toggleGroup };
}
