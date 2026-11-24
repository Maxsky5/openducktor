import { MOTION_EASE_OUT, prefersReducedMotion } from "@/components/ui/motion";

export const ENTRY_TIMING: KeyframeAnimationOptions = { duration: 200, easing: MOTION_EASE_OUT };

export type TranscriptSlideElements = {
  container: HTMLDivElement | null;
  turnsClip: HTMLDivElement | null;
  turns: HTMLDivElement | null;
};

type SlideBaseline = {
  scrollTop: number;
  scrollHeight: number;
  firstMountedKey: string | null;
};

type SlideMotionState =
  | { kind: "idle" }
  | { kind: "pending"; animation: Animation }
  | { kind: "sliding"; animation: Animation; turnsClip: HTMLDivElement };

export type TranscriptSlideController = {
  isSliding: () => boolean;
  isActive: () => boolean;
  readGrowthPx: (container: HTMLDivElement | null, firstMountedKey: string | null) => number | null;
  syncBaseline: (container: HTMLDivElement | null, firstMountedKey: string | null) => void;
  slide: (
    elements: TranscriptSlideElements,
    addedHeightPx: number,
    firstMountedKey: string | null,
  ) => boolean;
  trackPendingEntry: (
    animation: Animation,
    container: HTMLDivElement | null,
    firstMountedKey: string | null,
  ) => void;
  handlePinnedResize: (elements: TranscriptSlideElements) => void;
  cancel: (
    elements: TranscriptSlideElements,
    options?: { preserveVisualPosition?: boolean },
  ) => void;
  reset: (elements: TranscriptSlideElements) => void;
};

export const readCurrentTranslateY = (element: HTMLElement): number => {
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

/**
 * Coordinates the GPU transform slide of the transcript turns container, its overflow clip element,
 * and the continuous scroll baseline needed to compose consecutive appends and streamed growth.
 */
export const createTranscriptSlideController = (): TranscriptSlideController => {
  let state: SlideMotionState = { kind: "idle" };
  let baseline: SlideBaseline | null = null;

  const syncBaseline = (container: HTMLDivElement | null, firstMountedKey: string | null): void => {
    baseline = container
      ? {
          scrollTop: container.scrollTop,
          scrollHeight: container.scrollHeight,
          firstMountedKey,
        }
      : null;
  };

  const readGrowthPx = (
    container: HTMLDivElement | null,
    firstMountedKey: string | null,
  ): number | null => {
    if (!container || !baseline || baseline.scrollHeight <= 0) return null;
    // Evicting rows from the top of the sliding window shifts scrollHeight without moving visible rows.
    if (baseline.firstMountedKey !== firstMountedKey) return null;
    const scrollDeltaPx = container.scrollTop - baseline.scrollTop;
    const heightDeltaPx = container.scrollHeight - baseline.scrollHeight;
    return Math.min(scrollDeltaPx, heightDeltaPx);
  };

  const slide = (
    elements: TranscriptSlideElements,
    addedHeightPx: number,
    firstMountedKey: string | null,
  ): boolean => {
    const { container, turnsClip, turns } = elements;
    if (!container || !turnsClip || !turns || addedHeightPx <= 0) {
      syncBaseline(container, firstMountedKey);
      return false;
    }
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    if (maxScrollTop <= 0) {
      syncBaseline(container, firstMountedKey);
      return false;
    }

    const existingOffsetPx = state.kind === "sliding" ? readCurrentTranslateY(turns) : 0;
    // Bound only by maxScrollTop so tall appends preserve the prior viewport position on frame 0
    // and user scroll can always absorb the remaining offset into scrollTop.
    const totalOffsetPx = Math.min(existingOffsetPx + addedHeightPx, maxScrollTop);
    if (totalOffsetPx <= 0.5) {
      syncBaseline(container, firstMountedKey);
      return false;
    }

    if (state.kind === "sliding") {
      const previous = state;
      state = { kind: "idle" };
      previous.animation.cancel();
      if (previous.turnsClip !== turnsClip) {
        previous.turnsClip.style.overflowY = "";
      }
    }

    turnsClip.style.overflowY = "clip";
    const animation = turns.animate(
      [{ transform: `translateY(${totalOffsetPx}px)` }, { transform: "none" }],
      ENTRY_TIMING,
    );
    const nextState: SlideMotionState = { kind: "sliding", animation, turnsClip };
    state = nextState;
    syncBaseline(container, firstMountedKey);

    const cleanup = (): void => {
      if (state !== nextState) return;
      state = { kind: "idle" };
      nextState.turnsClip.style.overflowY = "";
    };
    void animation.finished?.then(cleanup, cleanup);
    return true;
  };

  const trackPendingEntry = (
    animation: Animation,
    container: HTMLDivElement | null,
    firstMountedKey: string | null,
  ): void => {
    if (state.kind === "sliding") {
      syncBaseline(container, firstMountedKey);
      return;
    }
    // Track non-overflowing entry so a streamed reply that crosses overflow mid-entry slides.
    const nextState: SlideMotionState = { kind: "pending", animation };
    state = nextState;
    syncBaseline(container, firstMountedKey);
    const cleanup = (): void => {
      if (state === nextState) {
        state = { kind: "idle" };
      }
    };
    void animation.finished?.then(cleanup, cleanup);
  };

  const handlePinnedResize = (elements: TranscriptSlideElements): void => {
    const { container } = elements;
    if (!container) return;
    const firstMountedKey = baseline?.firstMountedKey ?? null;
    if (state.kind === "idle" || prefersReducedMotion()) {
      if (baseline) {
        syncBaseline(container, firstMountedKey);
      }
      return;
    }
    const growthPx = readGrowthPx(container, firstMountedKey);
    if (growthPx !== null && growthPx > 0.5) {
      slide(elements, growthPx, firstMountedKey);
      return;
    }
    syncBaseline(container, firstMountedKey);
  };

  const cancel = (
    elements: TranscriptSlideElements,
    options?: { preserveVisualPosition?: boolean },
  ): void => {
    const { container, turnsClip, turns } = elements;
    let remainingOffsetPx = 0;
    if (state.kind === "sliding") {
      const previous = state;
      remainingOffsetPx =
        turns && options?.preserveVisualPosition ? readCurrentTranslateY(turns) : 0;
      state = { kind: "idle" };
      previous.animation.cancel();
      // Clear overflowY on the captured clip node so <Activity> ref detachment cannot strand it.
      previous.turnsClip.style.overflowY = "";
    } else {
      state = { kind: "idle" };
    }
    if (turnsClip) {
      turnsClip.style.overflowY = "";
    }
    if (container && remainingOffsetPx > 0) {
      container.scrollTop = Math.max(0, container.scrollTop - remainingOffsetPx);
    }
    if (container && baseline) {
      syncBaseline(container, baseline.firstMountedKey);
    }
  };

  const reset = (elements: TranscriptSlideElements): void => {
    cancel(elements);
    baseline = null;
  };

  return {
    isSliding: () => state.kind === "sliding",
    isActive: () => state.kind !== "idle",
    readGrowthPx,
    syncBaseline,
    slide,
    trackPendingEntry,
    handlePinnedResize,
    cancel,
    reset,
  };
};
