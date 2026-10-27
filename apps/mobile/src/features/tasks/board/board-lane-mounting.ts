import type { KanbanColumnId } from "@openducktor/workflows";
import { useEffect, useState } from "react";
import type { BoardColumn } from "./board-columns";

/** The lane to mount next: the unmounted lane nearest to the shown lane, right before left. */
export const nextLaneToMount = (
  columns: readonly BoardColumn[],
  shownIndex: number,
  mounted: ReadonlySet<KanbanColumnId>,
): KanbanColumnId | null => {
  for (let distance = 1; distance < columns.length; distance++) {
    for (const index of [shownIndex + distance, shownIndex - distance]) {
      const column = columns[index];
      if (column && !mounted.has(column.id)) return column.id;
    }
  }
  return null;
};

/**
 * The lanes of the phone board that have their list. The shown lane mounts at once. The others
 * mount one at a time in idle time, nearest first, so a new board does not hold the JS thread
 * for all its lanes at once. A mounted lane stays mounted, so a later swipe shows it at once.
 */
export const useMountedLanes = (
  columns: readonly BoardColumn[],
  shownIndex: number,
): ReadonlySet<KanbanColumnId> => {
  const shownId = columns[shownIndex]?.id ?? null;
  const [mounted, setMounted] = useState<ReadonlySet<KanbanColumnId>>(
    () => new Set(shownId === null ? [] : [shownId]),
  );
  // A lane that the user selects mounts in the same render.
  if (shownId !== null && !mounted.has(shownId)) setMounted(new Set([...mounted, shownId]));
  const next = nextLaneToMount(columns, shownIndex, mounted);
  useEffect(() => {
    if (next === null) return;
    const handle = requestIdleCallback(() => setMounted((current) => new Set([...current, next])));
    return () => cancelIdleCallback(handle);
  }, [next]);
  return mounted;
};
