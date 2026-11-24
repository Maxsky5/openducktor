import { type RefObject, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentChatTranscriptRow } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import { prefersReducedMotion } from "@/components/ui/motion";
import {
  createTranscriptSlideController,
  ENTRY_TIMING,
  type TranscriptSlideController,
  type TranscriptSlideElements,
} from "./agent-chat-transcript-slide-controller";

/** The rows of the transcript of a session that the hook saw at its last commit. */
type KnownRows = {
  sessionKey: string | null;
  isGrouped: boolean;
  count: number;
  firstKey: string | null;
  lastKey: string | null;
  keys: Set<string>;
};

export type TailOpenToolRun = {
  runKey: string;
  callCount: number;
};

type EnteringRows = {
  /**
   * "append": rows added after the previous final row (autoscroll shifts prior rows up).
   * "inserted-before-tail": a turn duration separator inserted directly above an already-mounted
   * final answer (autoscroll keeps that answer stationary, so the turns container must not slide).
   */
  mode: "append" | "inserted-before-tail";
  keys: readonly string[];
};

type ShownEnteringRows = {
  entering: EnteringRows;
  keys: Set<string>;
};

const NO_ENTERING_ROWS: EnteringRows = { mode: "append", keys: [] };

const ENTRY_KEYFRAMES: Keyframe[] = [
  { opacity: 0, transform: "translateY(6px)" },
  { opacity: 1, transform: "none" },
];
const ENTRY_FADE_KEYFRAMES: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];

/**
 * The rows that a live update added at the end of the transcript. A row that a session load gives,
 * a row of history that the transcript loads above the others, and a row whose message changed its
 * id, such as a sent message that the runtime confirms, are not new.
 */
const readEnteringRows = (
  known: KnownRows | null,
  sessionKey: string | null,
  isGrouped: boolean,
  rows: readonly AgentChatTranscriptRow[],
): EnteringRows => {
  if (!known || known.sessionKey !== sessionKey || known.isGrouped !== isGrouped) {
    return NO_ENTERING_ROWS;
  }
  if (known.count === 0 || rows.length <= known.count) return NO_ENTERING_ROWS;

  // Pure tail append: previous last row stayed at its exact index.
  if (rows[known.count - 1]?.key === known.lastKey) {
    const keys: string[] = [];
    for (let index = known.count; index < rows.length; index += 1) {
      const key = rows[index]?.key;
      if (key !== undefined && !known.keys.has(key)) keys.push(key);
    }
    return keys.length > 0 ? { mode: "append", keys } : NO_ENTERING_ROWS;
  }

  // Do not animate history prepended above the previously known start of the transcript.
  if (known.firstKey === null || rows[0]?.key !== known.firstKey) {
    return NO_ENTERING_ROWS;
  }

  // Rows inserted before an already-mounted final row (e.g., turn duration separator or a
  // timestamp-ordered tool row arriving after the current tail row).
  if (rows.at(-1)?.key === known.lastKey) {
    const keys: string[] = [];
    for (let index = 1; index < rows.length - 1; index += 1) {
      const key = rows[index]?.key;
      if (key !== undefined && !known.keys.has(key)) keys.push(key);
    }
    return keys.length > 0 ? { mode: "inserted-before-tail", keys } : NO_ENTERING_ROWS;
  }

  // Tail append coinciding with an in-place id swap earlier in the transcript (e.g., a streaming
  // assistant message adopting part identity or a confirmed optimistic user message).
  const appendedKeys: string[] = [];
  for (let index = known.count; index < rows.length; index += 1) {
    const key = rows[index]?.key;
    if (key !== undefined && !known.keys.has(key)) appendedKeys.push(key);
  }
  return appendedKeys.length > 0 ? { mode: "append", keys: appendedKeys } : NO_ENTERING_ROWS;
};

const rememberRows = (
  known: KnownRows | null,
  sessionKey: string | null,
  isGrouped: boolean,
  rows: readonly AgentChatTranscriptRow[],
): KnownRows => {
  // Rows that the transcript appends follow the known rows. Any other change reads all rows again.
  if (
    !known ||
    known.sessionKey !== sessionKey ||
    known.isGrouped !== isGrouped ||
    rows.length < known.count ||
    (known.count > 0 && rows[known.count - 1]?.key !== known.lastKey)
  ) {
    return {
      sessionKey,
      isGrouped,
      count: rows.length,
      firstKey: rows[0]?.key ?? null,
      lastKey: rows.at(-1)?.key ?? null,
      keys: new Set(rows.map((row) => row.key)),
    };
  }
  for (let index = known.count; index < rows.length; index += 1) {
    const key = rows[index]?.key;
    if (key !== undefined) known.keys.add(key);
  }
  if (known.firstKey === null) {
    known.firstKey = rows[0]?.key ?? null;
  }
  known.count = rows.length;
  known.lastKey = rows.at(-1)?.key ?? null;
  return known;
};

const measureVerticalSpan = (elements: readonly HTMLElement[]): number => {
  const first = elements[0];
  const last = elements.at(-1);
  if (!first || !last) return 0;
  if (first === last) return Math.max(0, first.getBoundingClientRect().height);
  return Math.max(0, last.getBoundingClientRect().bottom - first.getBoundingClientRect().top);
};

const collectUnshownEnteringRows = (
  turns: HTMLElement,
  entering: EnteringRows,
  shownRef: RefObject<ShownEnteringRows>,
): HTMLElement[] => {
  if (entering.keys.length === 0) return [];
  if (shownRef.current.entering !== entering) {
    shownRef.current = { entering, keys: new Set() };
  }
  const shown = shownRef.current.keys;
  const newlyMounted: HTMLElement[] = [];
  for (const key of entering.keys) {
    if (shown.has(key)) continue;
    const row = turns.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`);
    if (!row) continue;
    shown.add(key);
    newlyMounted.push(row);
  }
  return newlyMounted;
};

type UseAgentChatRowEntryMotionInput = {
  sessionKey: string | null;
  isGrouped: boolean;
  rows: readonly AgentChatTranscriptRow[];
  containerRef: RefObject<HTMLDivElement | null>;
  turnsClipRef: RefObject<HTMLDivElement | null> | undefined;
  turnsRef: RefObject<HTMLDivElement | null> | undefined;
  /** The rows in the row window. A new value means that the window mounted other rows. */
  mountedRows: readonly AgentChatTranscriptRow[];
  /** The open tool run at the end of the transcript while it grows below the latest-5 cap. */
  tailOpenRun: TailOpenToolRun | null;
  isPinned: () => boolean;
  isLatestWindow: boolean;
  syncScrollPosition: () => void;
  slideController?: TranscriptSlideController;
};

/**
 * Brings the rows that a live update adds in with short motion so autoscroll does not snap
 * existing messages upward. When pinned to an overflowing transcript, slides the turns container
 * via GPU transform (FLIP) while fading entering rows in; otherwise fades and rises entering rows.
 */
export function useAgentChatRowEntryMotion({
  sessionKey,
  isGrouped,
  rows,
  containerRef,
  turnsClipRef,
  turnsRef,
  mountedRows,
  tailOpenRun,
  isPinned,
  isLatestWindow,
  syncScrollPosition,
  slideController: externalSlideController,
}: UseAgentChatRowEntryMotionInput): TranscriptSlideController {
  const [ownSlideController] = useState(createTranscriptSlideController);
  const slideController = externalSlideController ?? ownSlideController;
  const knownRef = useRef<KnownRows | null>(null);
  // The known rows change only after a commit, so a render reads the rows of the last commit.
  const entering = useMemo(
    () => readEnteringRows(knownRef.current, sessionKey, isGrouped, rows),
    [isGrouped, rows, sessionKey],
  );
  const shownRef = useRef<ShownEnteringRows>({
    entering: NO_ENTERING_ROWS,
    keys: new Set(),
  });
  const previousTailOpenRunRef = useRef<(TailOpenToolRun & { sessionKey: string | null }) | null>(
    null,
  );
  const previousLastRowRef = useRef<{
    sessionKey: string | null;
    isGrouped: boolean;
    row: AgentChatTranscriptRow | null;
  } | null>(null);

  useLayoutEffect(() => {
    void sessionKey;
    void isGrouped;
    slideController.reset({
      container: containerRef.current,
      turnsClip: turnsClipRef?.current ?? null,
      turns: turnsRef?.current ?? null,
    });
  }, [containerRef, isGrouped, sessionKey, slideController, turnsClipRef, turnsRef]);

  useLayoutEffect(
    () => () => {
      // Reset refs and active slides when hidden in <Activity> or unmounted so returning to a
      // retained thread never slides background messages or leaves overflow-y: clip stranded.
      slideController.reset({
        container: containerRef.current,
        turnsClip: turnsClipRef?.current ?? null,
        turns: turnsRef?.current ?? null,
      });
      knownRef.current = null;
      previousTailOpenRunRef.current = null;
      previousLastRowRef.current = null;
    },
    [containerRef, slideController, turnsClipRef, turnsRef],
  );

  useLayoutEffect(() => {
    knownRef.current = rememberRows(knownRef.current, sessionKey, isGrouped, rows);
  }, [isGrouped, rows, sessionKey]);

  useLayoutEffect(() => {
    const previousTailRun = previousTailOpenRunRef.current;
    previousTailOpenRunRef.current = tailOpenRun ? { sessionKey, ...tailOpenRun } : null;
    const previousLastRow = previousLastRowRef.current;
    const currentLastRow = rows.at(-1) ?? null;
    previousLastRowRef.current = { sessionKey, isGrouped, row: currentLastRow };

    const elements: TranscriptSlideElements = {
      container: containerRef.current,
      turnsClip: turnsClipRef?.current ?? null,
      turns: turnsRef?.current ?? null,
    };
    const firstMountedKey = mountedRows[0]?.key ?? null;
    if (!elements.turns || prefersReducedMotion()) {
      slideController.syncBaseline(elements.container, firstMountedKey);
      return;
    }

    const isFollowingTail = isPinned() && isLatestWindow;
    const newlyMounted = collectUnshownEnteringRows(elements.turns, entering, shownRef);
    if (newlyMounted.length > 0) {
      if (entering.mode === "inserted-before-tail") {
        // Following the bottom keeps the existing answer below this row stationary. Fade the
        // inserted row in place without shifting or clipping the tail row that follows it.
        for (const row of newlyMounted) {
          row.animate(ENTRY_FADE_KEYFRAMES, ENTRY_TIMING);
        }
        const netGrowthPx = slideController.readGrowthPx(elements.container, firstMountedKey);
        const tailGrowthPx =
          netGrowthPx !== null ? netGrowthPx - measureVerticalSpan(newlyMounted) : 0;
        if (slideController.isSliding() && isFollowingTail && tailGrowthPx > 0.5) {
          slideController.slide(elements, tailGrowthPx, firstMountedKey);
        } else {
          slideController.syncBaseline(elements.container, firstMountedKey);
        }
        return;
      }

      const measuredGrowthPx = slideController.readGrowthPx(elements.container, firstMountedKey);
      const addedHeightPx =
        measuredGrowthPx !== null ? measuredGrowthPx : measureVerticalSpan(newlyMounted);
      const didSlide = isFollowingTail
        ? slideController.slide(elements, addedHeightPx, firstMountedKey)
        : false;
      const rowKeyframes = didSlide ? ENTRY_FADE_KEYFRAMES : ENTRY_KEYFRAMES;
      let lastRowAnimation: Animation | null = null;
      for (const row of newlyMounted) {
        lastRowAnimation = row.animate(rowKeyframes, ENTRY_TIMING);
      }
      if (!didSlide && isFollowingTail && lastRowAnimation && !slideController.isSliding()) {
        slideController.trackPendingEntry(lastRowAnimation, elements.container, firstMountedKey);
      } else if (!didSlide) {
        slideController.syncBaseline(elements.container, firstMountedKey);
      }
      return;
    }

    if (!isFollowingTail) {
      slideController.syncBaseline(elements.container, firstMountedKey);
      return;
    }

    const didTailOpenRunGrow = Boolean(
      tailOpenRun &&
      previousTailRun &&
      previousTailRun.sessionKey === sessionKey &&
      previousTailRun.runKey === tailOpenRun.runKey &&
      tailOpenRun.callCount > previousTailRun.callCount,
    );
    const didTailRowUpdate = Boolean(
      previousLastRow &&
      previousLastRow.sessionKey === sessionKey &&
      previousLastRow.isGrouped === isGrouped &&
      previousLastRow.row !== null &&
      currentLastRow !== null &&
      previousLastRow.row.key === currentLastRow.key &&
      previousLastRow.row !== currentLastRow,
    );

    syncScrollPosition();
    if (didTailOpenRunGrow || didTailRowUpdate || slideController.isActive()) {
      const growthPx = slideController.readGrowthPx(elements.container, firstMountedKey);
      if (growthPx !== null && growthPx > 0.5) {
        slideController.slide(elements, growthPx, firstMountedKey);
        return;
      }
    }

    slideController.syncBaseline(elements.container, firstMountedKey);
  }, [
    containerRef,
    entering,
    isGrouped,
    isLatestWindow,
    isPinned,
    mountedRows,
    rows,
    sessionKey,
    slideController,
    syncScrollPosition,
    tailOpenRun,
    turnsClipRef,
    turnsRef,
  ]);

  return slideController;
}
