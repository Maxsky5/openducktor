import type { KanbanColumnId } from "@openducktor/core";
import { useMemo } from "react";
import type { BoardColumn } from "./board-columns";

/**
 * The lane ids of a board, as one array while the lanes stay the same. A task change gives the
 * columns new objects, and an animated style that read values built from them would send its
 * worklet to the UI thread again.
 */
export const useLaneIds = (columns: readonly BoardColumn[]): readonly KanbanColumnId[] => {
  const key = columns.map((column) => column.id).join(" ");
  return useMemo(
    // SAFETY: the key joins the lane ids of the columns.
    () => (key === "" ? [] : (key.split(" ") as KanbanColumnId[])),
    [key],
  );
};
