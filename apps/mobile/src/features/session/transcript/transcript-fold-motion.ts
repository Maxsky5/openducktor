import { createContext, use } from "react";

/** How long the cells move after a row grows or shrinks. */
export const FOLD_MOTION_MS = 280;

/**
 * The motion of the cells of a transcript list after a row grows or shrinks. The list takes its
 * new layout at once, in one frame, with the scroll correction that keeps its anchor row in place.
 * In that same commit, the cells that moved start back at their old place with a translation, and
 * the translation goes to zero on the UI thread. A translation never changes the layout, so the
 * scroll anchor stays exact. This is the FLIP technique.
 */
export type FoldMotionPhase = "start" | "run";

export type FoldMotion = {
  /** Changes for each motion, so cells start each motion again. */
  readonly id: number;
  /** The list index of the row that grew or shrank. */
  readonly pivot: number;
  /** True when the rows under the pivot on screen have lower indices: the list is inverted. */
  readonly inverted: boolean;
  /** The start translation of the rows under the pivot on screen, in points. */
  readonly belowOffset: number;
  /** The start translation of the pivot and the rows over it on screen, in points. */
  readonly pivotOffset: number;
  /**
   * `start` mounts the start offsets as plain styles with the new layout, in one mount. A frame
   * later, `run` gives the moved cells their layout animation and sets their offsets to zero.
   * Reanimated reads the animation before it mounts that change, so the cells glide home from
   * where the start mount put them.
   */
  readonly phase: FoldMotionPhase;
};

/**
 * The start translations of a resize, from the anchor rule of the list. A list that is not
 * inverted, and an inverted list whose latest row is out of view, keep the pivot and the rows over
 * it in place, so the rows under it move. An inverted list whose latest row is in view keeps that
 * row in place, so the pivot and the rows over it move. `delta` is the new height of the pivot
 * minus its old height. The moving rows start where they were: down is positive.
 */
export const foldMotion = ({
  id,
  pivot,
  inverted,
  latestRowInView,
  delta,
}: {
  id: number;
  pivot: number;
  inverted: boolean;
  latestRowInView: boolean;
  delta: number;
}): FoldMotion => {
  const pivotStays = !inverted || !latestRowInView;
  return {
    id,
    pivot,
    inverted,
    belowOffset: pivotStays ? -delta : 0,
    pivotOffset: pivotStays ? 0 : delta,
    phase: "start",
  };
};

/** Whether the cell at `index` is under the pivot on the screen. */
export const isBelowPivot = (motion: FoldMotion, index: number): boolean =>
  motion.inverted ? index < motion.pivot : index > motion.pivot;

/** The start translation of the cell at `index`, or 0 for a cell that does not move. */
export const cellStartOffset = (motion: FoldMotion | null, index: number): number => {
  if (!motion) return 0;
  return isBelowPivot(motion, index) ? motion.belowOffset : motion.pivotOffset;
};

/** Sets the motion that the cells of a list read, as a React state setter does. */
type SetFoldMotion = (update: (current: FoldMotion | null) => FoldMotion | null) => void;

/**
 * Starts, runs, and ends the motions of one list. The motion is React state of the list, so it
 * renders in the same batch as the new layout that the list commits for the resize.
 */
export type FoldMotionController = {
  /** A new motion ID. */
  nextId: () => number;
  start: (motion: FoldMotion, durationMs: number) => void;
  /** Runs a motion whose start offsets the list mounted. */
  advance: (id: number) => void;
};

export const createFoldMotionController = (setMotion: SetFoldMotion): FoldMotionController => {
  let lastId = 0;
  let endTimer: ReturnType<typeof setTimeout> | null = null;
  return {
    nextId: () => {
      lastId += 1;
      return lastId;
    },
    start(motion, durationMs) {
      setMotion(() => motion);
      if (endTimer) clearTimeout(endTimer);
      // A motion that ended moves no cell, so a later change of the indices moves none either.
      endTimer = setTimeout(() => {
        endTimer = null;
        setMotion((current) => (current?.id === motion.id ? null : current));
      }, durationMs);
    },
    advance(id) {
      setMotion((current) =>
        current?.id === id && current.phase === "start" ? { ...current, phase: "run" } : current,
      );
    },
  };
};

/** The list that a row is in: its motions, whether it is inverted, and its visible rows. */
export type FoldMotionList = {
  motions: FoldMotionController;
  inverted: boolean;
  /** The lowest index of the rows in view. */
  firstVisibleIndex: () => number;
  /**
   * Gives the list the new height of the row at `index` before the row renders it, so the row,
   * the rows that the list moves, and its scroll correction mount in one commit.
   */
  resizeRow: (index: number, delta: number) => void;
};

const FoldMotionListContext = createContext<FoldMotionList | null>(null);

export const FoldMotionListProvider = FoldMotionListContext;

/** The list of the row, or null outside a transcript list. */
export const useFoldMotionList = (): FoldMotionList | null => use(FoldMotionListContext);

/** The current motion of the list. Only the cells read it, so a motion renders only the cells. */
const FoldMotionContext = createContext<FoldMotion | null>(null);

export const FoldMotionProvider = FoldMotionContext;

export const useFoldMotion = (): FoldMotion | null => use(FoldMotionContext);

/**
 * The list index of the cell that a row renders in. The cell keeps it current, and a row reads it
 * only when it resizes, so a change of the index renders no row again.
 */
export type CellIndex = { readonly current: number };

const CellIndexContext = createContext<CellIndex | null>(null);

export const CellIndexProvider = CellIndexContext;

export const useCellIndex = (): CellIndex | null => use(CellIndexContext);
