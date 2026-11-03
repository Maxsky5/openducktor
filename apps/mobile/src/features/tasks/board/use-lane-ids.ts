import type { KanbanColumnId } from "@openducktor/workflows";
import { useMemo } from "react";
import type { BoardColumn } from "./board-columns";

/**
 * The lane ids of a board, as one array while the lanes stay the same. A task change gives the
 * columns new objects, and an animated style that read values built from them would send its
 * worklet to the UI thread again.
 */
export const useLaneIds = (columns: readonly BoardColumn[]): readonly KanbanColumnId[] => {
  const key = JSON.stringify(columns.map((column) => column.id));
  return useMemo(
    // SAFETY: the key joins the lane ids of the columns.
    () => JSON.parse(key) as KanbanColumnId[],
    [key],
  );
};
