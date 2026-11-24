import { type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { AgentChatTranscriptRow } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import { MOTION_EASE_OUT, prefersReducedMotion } from "@/components/ui/motion";
import type { AgentChatScrollUnpinOptions } from "./use-agent-chat-scroll-controller";

/** The rows of the transcript of a session that the hook saw at its last commit. */
type KnownRows = {
  sessionKey: string | null;
  isGrouped: boolean;
  count: number;
  lastKey: string | null;
  keys: Set<string>;
};

export type TailOpenToolRun = {
  runKey: string;
  callCount: number;
};

export type AgentChatRowEntryMotionControls = {
  cancelSlide: (options?: AgentChatScrollUnpinOptions) => void;
  onPinnedResize: () => void;
};

type ActiveEntryMotion = {
  /** Turns container slide animation when overflowing, or the entering row animation before overflow. */
  animation: Animation;
  isSlide: boolean;
  scrollTop: number;
  scrollHeight: number;
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

const NO_ENTERING_ROWS: EnteringRows = { mode: "append", keys: [] };

const ENTRY_KEYFRAMES: Keyframe[] = [
  { opacity: 0, transform: "translateY(6px)" },
  { opacity: 1, transform: "none" },
];
const ENTRY_FADE_KEYFRAMES: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
const ENTRY_TIMING: KeyframeAnimationOptions = { duration: 200, easing: MOTION_EASE_OUT };

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

  // Turn duration separator inserted immediately before the already-mounted final assistant row.
  const durationCandidate = rows[rows.length - 2];
  if (
    rows.length === known.count + 1 &&
    rows.at(-1)?.key === known.lastKey &&
    durationCandidate?.kind === "turn_duration" &&
    !known.keys.has(durationCandidate.key)
  ) {
    return { mode: "inserted-before-tail", keys: [durationCandidate.key] };
  }

  return NO_ENTERING_ROWS;
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
      lastKey: rows.at(-1)?.key ?? null,
      keys: new Set(rows.map((row) => row.key)),
    };
  }
  for (let index = known.count; index < rows.length; index += 1) {
    const key = rows[index]?.key;
    if (key !== undefined) known.keys.add(key);
  }
  known.count = rows.length;
  known.lastKey = rows.at(-1)?.key ?? null;
  return known;
};

const readCurrentTranslateY = (element: HTMLElement): number => {
  const transform = getComputedStyle(element).transform;
  if (!transform || transform === "none") return 0;
  const Matrix = globalThis.DOMMatrixReadOnly;
  if (Matrix) {
    const value = new Matrix(transform).m42;
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }
  const match = /matrix\(([^)]+)\)/.exec(transform);
  const parts = match?.[1]?.split(",");
  const ty = parts ? Number(parts[5]) : Number.NaN;
  return Number.isFinite(ty) ? Math.max(0, ty) : 0;
};

const measureVerticalSpan = (elements: readonly HTMLElement[]): number => {
  const first = elements[0];
  const last = elements.at(-1);
  if (!first || !last) return 0;
  if (first === last) return Math.max(0, first.getBoundingClientRect().height);
  return Math.max(0, last.getBoundingClientRect().bottom - first.getBoundingClientRect().top);
};

const measureAppendedToolRunLinesHeight = (
  root: HTMLElement,
  runKey: string,
  addedCount: number,
): number => {
  const runElement = root.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(runKey)}"]`);
  const list = runElement?.querySelector("ul");
  if (!list) return 0;
  const visibleItems: HTMLElement[] = [];
  for (const child of list.children) {
    if (child instanceof HTMLElement && child.getAttribute("aria-hidden") !== "true") {
      visibleItems.push(child);
    }
  }
  if (visibleItems.length === 0) return 0;
  return measureVerticalSpan(visibleItems.slice(-addedCount));
};

type ShownEnteringRows = {
  entering: EnteringRows;
  keys: Set<string>;
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

/**
 * Brings the rows that a live update adds in with smooth motion so autoscroll does not snap
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
}: {
  sessionKey: string | null;
  isGrouped: boolean;
  rows: readonly AgentChatTranscriptRow[];
  containerRef: RefObject<HTMLDivElement | null>;
  turnsClipRef: RefObject<HTMLDivElement | null>;
  turnsRef: RefObject<HTMLDivElement | null>;
  /** The rows in the row window. A new value means that the window mounted other rows. */
  mountedRows: readonly AgentChatTranscriptRow[];
  /** The open tool run at the end of the transcript while it grows below the latest-5 cap. */
  tailOpenRun: TailOpenToolRun | null;
  isPinned: () => boolean;
  isLatestWindow: boolean;
  syncScrollPosition: () => void;
}): AgentChatRowEntryMotionControls {
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
  const activeEntryRef = useRef<ActiveEntryMotion | null>(null);
  const previousTailOpenRunRef = useRef<(TailOpenToolRun & { sessionKey: string | null }) | null>(
    null,
  );

  const cancelSlide = useCallback(
    (options?: AgentChatScrollUnpinOptions) => {
      const activeEntry = activeEntryRef.current;
      const turns = turnsRef.current;
      const container = containerRef.current;
      const remainingOffsetPx =
        activeEntry?.isSlide && turns && options?.preserveVisualPosition
          ? readCurrentTranslateY(turns)
          : 0;
      if (activeEntry) {
        activeEntryRef.current = null;
        if (activeEntry.isSlide) {
          activeEntry.animation.cancel();
        }
      }
      const turnsClip = turnsClipRef.current;
      if (turnsClip) {
        turnsClip.style.overflowY = "";
      }
      if (container && remainingOffsetPx > 0) {
        container.scrollTop = Math.max(0, container.scrollTop - remainingOffsetPx);
      }
    },
    [containerRef, turnsClipRef, turnsRef],
  );

  const slideTranscript = useCallback(
    (addedHeightPx: number): boolean => {
      const container = containerRef.current;
      const turnsClip = turnsClipRef.current;
      const turns = turnsRef.current;
      if (!container || !turnsClip || !turns || addedHeightPx <= 0) return false;
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      if (maxScrollTop <= 0) return false;

      const activeEntry = activeEntryRef.current;
      const existingOffsetPx = activeEntry?.isSlide ? readCurrentTranslateY(turns) : 0;
      // Start from the full scroll displacement (bounded only by maxScrollTop) so tall appends
      // preserve the prior row position on frame 0 and unpinning can absorb the remaining offset.
      const totalOffsetPx = Math.min(existingOffsetPx + addedHeightPx, maxScrollTop);
      if (totalOffsetPx <= 0.5) return false;

      if (activeEntry?.isSlide) {
        activeEntryRef.current = null;
        activeEntry.animation.cancel();
      }
      turnsClip.style.overflowY = "clip";
      const animation = turns.animate(
        [{ transform: `translateY(${totalOffsetPx}px)` }, { transform: "none" }],
        ENTRY_TIMING,
      );
      const nextEntry: ActiveEntryMotion = {
        animation,
        isSlide: true,
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
      };
      activeEntryRef.current = nextEntry;
      const cleanup = (): void => {
        if (activeEntryRef.current !== nextEntry) return;
        activeEntryRef.current = null;
        turnsClip.style.overflowY = "";
      };
      void animation.finished?.then(cleanup, cleanup);
      return true;
    },
    [containerRef, turnsClipRef, turnsRef],
  );

  const readActiveGrowthPx = useCallback((): number => {
    const activeEntry = activeEntryRef.current;
    const container = containerRef.current;
    if (!activeEntry || !container) return 0;
    const scrollDeltaPx = container.scrollTop - activeEntry.scrollTop;
    const heightDeltaPx = container.scrollHeight - activeEntry.scrollHeight;
    return Math.min(scrollDeltaPx, heightDeltaPx);
  }, [containerRef]);

  const syncActiveEntryBaseline = useCallback(() => {
    const activeEntry = activeEntryRef.current;
    const container = containerRef.current;
    if (!activeEntry || !container) return;
    activeEntry.scrollTop = container.scrollTop;
    activeEntry.scrollHeight = container.scrollHeight;
  }, [containerRef]);

  const trackPendingEntry = useCallback(
    (animation: Animation) => {
      const container = containerRef.current;
      if (!container) return;
      // Track non-overflowing entry so a streamed reply that crosses overflow mid-entry slides.
      const pendingEntry: ActiveEntryMotion = {
        animation,
        isSlide: false,
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
      };
      activeEntryRef.current = pendingEntry;
      const cleanupPending = (): void => {
        if (activeEntryRef.current === pendingEntry) {
          activeEntryRef.current = null;
        }
      };
      void animation.finished?.then(cleanupPending, cleanupPending);
    },
    [containerRef],
  );

  const onPinnedResize = useCallback(() => {
    const activeEntry = activeEntryRef.current;
    if (!activeEntry || !isPinned() || !isLatestWindow || prefersReducedMotion()) {
      return;
    }
    const growthPx = readActiveGrowthPx();
    if (growthPx <= 0.5) {
      // Keep the baseline aligned when only viewport height changed or content shrank.
      syncActiveEntryBaseline();
      return;
    }
    slideTranscript(growthPx);
  }, [isLatestWindow, isPinned, readActiveGrowthPx, slideTranscript, syncActiveEntryBaseline]);

  useLayoutEffect(() => {
    void sessionKey;
    cancelSlide();
  }, [cancelSlide, sessionKey]);

  useEffect(() => () => cancelSlide(), [cancelSlide]);

  useLayoutEffect(() => {
    knownRef.current = rememberRows(knownRef.current, sessionKey, isGrouped, rows);
  }, [isGrouped, rows, sessionKey]);

  useLayoutEffect(() => {
    void mountedRows;
    const previousTailRun = previousTailOpenRunRef.current;
    previousTailOpenRunRef.current = tailOpenRun ? { sessionKey, ...tailOpenRun } : null;

    const turns = turnsRef.current;
    if (!turns || prefersReducedMotion()) return;
    const isFollowingTail = isPinned() && isLatestWindow;

    const newlyMounted = collectUnshownEnteringRows(turns, entering, shownRef);
    if (newlyMounted.length > 0) {
      if (entering.mode === "inserted-before-tail") {
        // Following the bottom keeps the existing answer below this separator stationary. Fade
        // the separator in place without shifting or clipping the answer that follows it.
        for (const row of newlyMounted) {
          row.animate(ENTRY_FADE_KEYFRAMES, ENTRY_TIMING);
        }
        const activeEntry = activeEntryRef.current;
        if (activeEntry) {
          const tailGrowthPx = readActiveGrowthPx() - measureVerticalSpan(newlyMounted);
          if (activeEntry.isSlide && isFollowingTail && tailGrowthPx > 0.5) {
            slideTranscript(tailGrowthPx);
          } else {
            syncActiveEntryBaseline();
          }
        }
        return;
      }

      const addedHeightPx = activeEntryRef.current
        ? readActiveGrowthPx()
        : measureVerticalSpan(newlyMounted);
      const didSlide = isFollowingTail ? slideTranscript(addedHeightPx) : false;
      const rowKeyframes = didSlide ? ENTRY_FADE_KEYFRAMES : ENTRY_KEYFRAMES;
      let lastRowAnimation: Animation | null = null;
      for (const row of newlyMounted) {
        lastRowAnimation = row.animate(rowKeyframes, ENTRY_TIMING);
      }
      if (!didSlide && isFollowingTail) {
        if (activeEntryRef.current) {
          // Keep an active slide owned and align its baseline when net scroll height did not grow.
          syncActiveEntryBaseline();
        } else if (lastRowAnimation) {
          trackPendingEntry(lastRowAnimation);
        }
      }
      return;
    }

    if (!isFollowingTail) return;

    if (
      tailOpenRun &&
      previousTailRun &&
      previousTailRun.sessionKey === sessionKey &&
      previousTailRun.runKey === tailOpenRun.runKey &&
      tailOpenRun.callCount > previousTailRun.callCount
    ) {
      syncScrollPosition();
      const addedCount = tailOpenRun.callCount - previousTailRun.callCount;
      const addedHeightPx = activeEntryRef.current
        ? readActiveGrowthPx()
        : measureAppendedToolRunLinesHeight(turns, tailOpenRun.runKey, addedCount);
      if (!slideTranscript(addedHeightPx) && activeEntryRef.current) {
        syncActiveEntryBaseline();
      }
      return;
    }

    // Keep an active entry motion aligned when a streamed reply grows on the same row.
    if (activeEntryRef.current) {
      syncScrollPosition();
      onPinnedResize();
    }
  }, [
    entering,
    isLatestWindow,
    isPinned,
    mountedRows,
    onPinnedResize,
    readActiveGrowthPx,
    sessionKey,
    slideTranscript,
    syncActiveEntryBaseline,
    syncScrollPosition,
    tailOpenRun,
    trackPendingEntry,
    turnsRef,
  ]);

  return useMemo(() => ({ cancelSlide, onPinnedResize }), [cancelSlide, onPinnedResize]);
}
