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
}): (options?: AgentChatScrollUnpinOptions) => void {
  const knownRef = useRef<KnownRows | null>(null);
  // The known rows change only after a commit, so a render reads the rows of the last commit.
  const entering = useMemo(
    () => readEnteringRows(knownRef.current, sessionKey, isGrouped, rows),
    [isGrouped, rows, sessionKey],
  );
  const shownRef = useRef<{ entering: EnteringRows; keys: Set<string> }>({
    entering: NO_ENTERING_ROWS,
    keys: new Set(),
  });
  const activeSlideRef = useRef<Animation | null>(null);
  const previousTailOpenRunRef = useRef<(TailOpenToolRun & { sessionKey: string | null }) | null>(
    null,
  );

  const cancelSlide = useCallback(
    (options?: AgentChatScrollUnpinOptions) => {
      const activeSlide = activeSlideRef.current;
      const turns = turnsRef.current;
      const container = containerRef.current;
      const remainingOffsetPx =
        activeSlide && turns && options?.preserveVisualPosition ? readCurrentTranslateY(turns) : 0;
      if (activeSlide) {
        activeSlideRef.current = null;
        activeSlide.cancel();
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

      const activeSlide = activeSlideRef.current;
      const existingOffsetPx = activeSlide ? readCurrentTranslateY(turns) : 0;
      // Start from the full scroll displacement (bounded only by maxScrollTop) so tall appends
      // preserve the prior row position on frame 0 and unpinning can absorb the remaining offset.
      const totalOffsetPx = Math.min(existingOffsetPx + addedHeightPx, maxScrollTop);
      if (totalOffsetPx <= 0.5) return false;

      if (activeSlide) {
        activeSlideRef.current = null;
        activeSlide.cancel();
      }
      turnsClip.style.overflowY = "clip";
      const animation = turns.animate(
        [{ transform: `translateY(${totalOffsetPx}px)` }, { transform: "none" }],
        ENTRY_TIMING,
      );
      activeSlideRef.current = animation;
      const cleanup = (): void => {
        if (activeSlideRef.current !== animation) return;
        activeSlideRef.current = null;
        turnsClip.style.overflowY = "";
      };
      void animation.finished?.then(cleanup, cleanup);
      return true;
    },
    [containerRef, turnsClipRef, turnsRef],
  );

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

    if (entering.keys.length > 0) {
      if (shownRef.current.entering !== entering) shownRef.current = { entering, keys: new Set() };
      const shown = shownRef.current.keys;
      const newlyMounted: HTMLElement[] = [];
      for (const key of entering.keys) {
        if (shown.has(key)) continue;
        const row = turns.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`);
        if (!row) continue;
        shown.add(key);
        newlyMounted.push(row);
      }
      if (newlyMounted.length === 0) return;

      if (entering.mode === "inserted-before-tail") {
        // Following the bottom keeps the existing answer below this separator stationary. Fade
        // the separator in place without shifting or clipping the answer that follows it.
        for (const row of newlyMounted) {
          row.animate(ENTRY_FADE_KEYFRAMES, ENTRY_TIMING);
        }
        return;
      }

      const didSlide =
        isPinned() && isLatestWindow ? slideTranscript(measureVerticalSpan(newlyMounted)) : false;
      const rowKeyframes = didSlide ? ENTRY_FADE_KEYFRAMES : ENTRY_KEYFRAMES;
      for (const row of newlyMounted) {
        row.animate(rowKeyframes, ENTRY_TIMING);
      }
      return;
    }

    if (
      tailOpenRun &&
      previousTailRun &&
      previousTailRun.sessionKey === sessionKey &&
      previousTailRun.runKey === tailOpenRun.runKey &&
      tailOpenRun.callCount > previousTailRun.callCount &&
      isPinned() &&
      isLatestWindow
    ) {
      syncScrollPosition();
      const addedCount = tailOpenRun.callCount - previousTailRun.callCount;
      slideTranscript(measureAppendedToolRunLinesHeight(turns, tailOpenRun.runKey, addedCount));
    }
  }, [
    entering,
    isLatestWindow,
    isPinned,
    mountedRows,
    sessionKey,
    slideTranscript,
    syncScrollPosition,
    tailOpenRun,
    turnsRef,
  ]);

  return cancelSlide;
}
