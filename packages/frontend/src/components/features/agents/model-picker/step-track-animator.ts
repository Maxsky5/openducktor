import {
  centerFor,
  clamp,
  EDGE_PAD,
  labelCenter,
  plateauFor,
  shellPath,
  TRACK_HEIGHT,
  thumbBounds,
} from "./step-track-geometry";

export type StepTrackStopLike = {
  value: string;
  label: string;
  disabled?: boolean | undefined;
};

export type StepTrackFillLike = {
  from: string;
  to: string;
  tick: string;
};

export const DEFAULT_TRACK_WIDTH = 200;
export const INITIAL_LABEL_WIDTH = 44;
export const TICK_ON_THUMB = "rgba(0, 0, 0, 0.45)";

export const SPEED_STREAKS = [
  { y: -6, width: 12, delay: 0.1 },
  { y: 0, width: 20, delay: 0 },
  { y: 6, width: 10, delay: 0.18 },
] as const;

const MOVE_MS = 220;
const DRAG_STRETCH_MS = 160;
const PLATEAU_MS = 110;
const BURST_MS = 460;
const POP_IN_MS = 90;
const POP_OUT_MS = 320;
const FILL_FADE_STOP_SPAN = 0.35;

/** Fades the fill out cleanly at stop 0 so the leftmost thumb never gets a thin halo ring. */
export const fillStrengthFor = (pos: number, stopCount: number): number =>
  stopCount > 1 ? clamp(pos / FILL_FADE_STOP_SPAN, 0, 1) : 1;

const easeOutCubic = (t: number): number => 1 - (1 - clamp(t, 0, 1)) ** 3;

/** Critically underdamped spring curve matching mobile's dampingRatio 0.55 return to 1. */
const easeSpringBack = (t: number): number => {
  const x = clamp(t, 0, 1);
  return 1 - Math.exp(-5.2 * x) * Math.cos(8.4 * x);
};

const prefersReducedMotion = (): boolean =>
  globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

type KeyframeSegment = {
  to: number;
  duration: number;
  easing: "cubic" | "spring";
};

type AnimChannel = {
  value: number;
  from: number;
  startAt: number;
  queue: KeyframeSegment[];
};

const createChannel = (initial: number): AnimChannel => ({
  value: initial,
  from: initial,
  startAt: 0,
  queue: [],
});

const snapChannel = (channel: AnimChannel, target: number): void => {
  channel.value = target;
  channel.from = target;
  channel.startAt = 0;
  channel.queue = [];
};

const animateChannel = (
  channel: AnimChannel,
  now: number,
  segments: readonly KeyframeSegment[],
  reducedMotion: boolean,
): void => {
  if (segments.length === 0) {
    return;
  }
  if (reducedMotion) {
    snapChannel(channel, segments[segments.length - 1]!.to);
    return;
  }
  channel.from = channel.value;
  channel.startAt = now;
  channel.queue = segments.map((segment) => ({ ...segment }));
};

const stepChannel = (channel: AnimChannel, now: number): boolean => {
  while (channel.queue.length > 0) {
    const seg = channel.queue[0]!;
    const elapsed = now - channel.startAt;
    if (seg.duration <= 0 || elapsed >= seg.duration) {
      channel.value = seg.to;
      channel.from = seg.to;
      channel.startAt += seg.duration;
      channel.queue.shift();
      continue;
    }
    const rawT = Math.max(0, elapsed) / seg.duration;
    const eased = seg.easing === "spring" ? easeSpringBack(rawT) : easeOutCubic(rawT);
    channel.value = channel.from + (seg.to - channel.from) * eased;
    return true;
  }
  return false;
};

export type StepTrackDomNodes = {
  shellPath: SVGPathElement | null;
  fillRects: Array<SVGRectElement | null>;
  thumb: HTMLDivElement | null;
  mark: HTMLSpanElement | null;
  ticks: Array<HTMLSpanElement | null>;
  streaks: Array<HTMLSpanElement | null>;
  label: HTMLDivElement | null;
};

export type StepTrackAnimatorSync = {
  stops: readonly StepTrackStopLike[];
  fills: readonly StepTrackFillLike[];
  hideTickOnThumb: boolean;
  restIndex: number;
  selectedIndex: number;
  onArrive: (index: number) => void;
};

export type StepTrackAnimator = {
  nodes: StepTrackDomNodes;
  getTrackWidth: () => number;
  sync: (input: StepTrackAnimatorSync) => void;
  setTrackWidth: (width: number) => boolean;
  setLabelWidth: (width: number) => void;
  beginDrag: () => void;
  moveDrag: (position: number) => void;
  endDrag: () => number;
  cancelDrag: (restIndex: number) => void;
  settleTo: (targetIndex: number) => void;
  destroy: () => void;
};

export function createStepTrackAnimator(initialIndex: number): StepTrackAnimator {
  const display = createChannel(initialIndex);
  const dragStretch = createChannel(0);
  const plateau = createChannel(plateauFor(INITIAL_LABEL_WIDTH));
  const burst = createChannel(0);
  const pop = createChannel(1);

  let trackWidth = DEFAULT_TRACK_WIDTH;
  let labelWidth = INITIAL_LABEL_WIDTH;
  let hasMeasuredLabel = false;
  let dragging = false;
  let liveIndex = initialIndex;
  let targetIndex = initialIndex;
  let prevStopCount = -1;
  let lastShellD = "";
  let rafId: number | null = null;
  let stops: readonly StepTrackStopLike[] = [];
  let fills: readonly StepTrackFillLike[] = [];
  let hideTickOnThumb = false;
  let onArrive: (index: number) => void = () => {};

  const nodes: StepTrackDomNodes = {
    shellPath: null,
    fillRects: [],
    thumb: null,
    mark: null,
    ticks: [],
    streaks: [],
    label: null,
  };

  /** Positions tick centers only when track width or stop count changes (never per-frame). */
  const layoutTicks = (): void => {
    const stopCount = stops.length;
    for (let i = 0; i < stopCount; i += 1) {
      const tick = nodes.ticks[i];
      if (tick) {
        tick.style.left = `${centerFor(i, stopCount, trackWidth) - 0.75}px`;
      }
    }
  };

  const paint = (): void => {
    const stopCount = stops.length;
    if (stopCount === 0) {
      return;
    }
    const pos = clamp(display.value, 0, Math.max(0, stopCount - 1));
    const stretchValue = clamp(dragStretch.value, 0, 1);
    const plateauValue = plateau.value;
    const cx = centerFor(pos, stopCount, trackWidth);
    const bounds = thumbBounds(cx, stretchValue, trackWidth);

    if (nodes.shellPath) {
      const nextShellD = shellPath(cx, 1, plateauValue, trackWidth);
      if (nextShellD !== lastShellD) {
        lastShellD = nextShellD;
        nodes.shellPath.setAttribute("d", nextShellD);
      }
    }

    const blend = fills.length > 1;
    const fillStrength = fillStrengthFor(pos, stopCount);
    const fillWidth = String(Math.min(trackWidth, bounds.right + EDGE_PAD));
    for (let i = 0; i < fills.length; i += 1) {
      const rect = nodes.fillRects[i];
      if (!rect) {
        continue;
      }
      const stopWeight = blend ? Math.max(0, 1 - Math.abs(pos - i)) : 1;
      rect.setAttribute("width", fillWidth);
      rect.setAttribute("opacity", String(stopWeight * fillStrength));
    }

    if (nodes.thumb) {
      nodes.thumb.style.width = `${bounds.right - bounds.left}px`;
      nodes.thumb.style.transform = `translate3d(${bounds.left}px, 0, 0)`;
    }

    if (nodes.mark) {
      nodes.mark.style.transform = `scale(${pop.value})`;
    }

    const nearest = clamp(Math.round(pos), 0, Math.max(0, stopCount - 1));
    for (let i = 0; i < stopCount; i += 1) {
      const tick = nodes.ticks[i];
      if (!tick) {
        continue;
      }
      const tickX = centerFor(i, stopCount, trackWidth);
      const onThumb = tickX >= bounds.left + 0.5 && tickX <= bounds.right - 0.5;
      const active = nearest === i && !onThumb;
      const isStopDisabled = stops[i]?.disabled === true;
      const fillTick = (fills[i] ?? fills[0])?.tick ?? "var(--step-track-tick)";
      tick.style.opacity = onThumb && hideTickOnThumb ? "0" : isStopDisabled ? "0.28" : "1";
      tick.style.backgroundColor = onThumb
        ? TICK_ON_THUMB
        : active
          ? fillTick
          : "var(--step-track-tick)";
    }

    if (hideTickOnThumb) {
      const burstValue = burst.value;
      const visible = burstValue > 0 && burstValue < 1;
      for (let i = 0; i < SPEED_STREAKS.length; i += 1) {
        const streakEl = nodes.streaks[i];
        const spec = SPEED_STREAKS[i]!;
        if (!streakEl) {
          continue;
        }
        if (!visible) {
          streakEl.style.opacity = "0";
          continue;
        }
        const t = clamp((burstValue - spec.delay) / (1 - spec.delay), 0, 1);
        streakEl.style.opacity = String(0.85 * (1 - t));
        streakEl.style.transform = `translate3d(${bounds.left - spec.width - 4 - 34 * t}px, 0, 0) scaleX(${1 - 0.4 * t})`;
      }
    }

    if (nodes.label) {
      const lx = labelCenter(cx, plateauValue, trackWidth);
      nodes.label.style.opacity = "1";
      nodes.label.style.transform = `translate3d(${lx - labelWidth / 2}px, 0, 0)`;
    }
  };

  const startLoop = (): void => {
    if (rafId !== null) {
      return;
    }
    const tick = (now: number) => {
      const stillRunning = [
        stepChannel(display, now),
        stepChannel(dragStretch, now),
        stepChannel(plateau, now),
        stepChannel(burst, now),
        stepChannel(pop, now),
      ].some(Boolean);
      paint();
      rafId = stillRunning ? requestAnimationFrame(tick) : null;
    };
    paint();
    rafId = requestAnimationFrame(tick);
  };

  const arrive = (index: number): void => {
    const previous = liveIndex;
    if (index === previous) {
      return;
    }
    liveIndex = index;
    onArrive(index);
    if (prefersReducedMotion()) {
      return;
    }
    const now = performance.now();
    animateChannel(
      pop,
      now,
      [
        { to: index > previous ? 1.28 : 0.82, duration: POP_IN_MS, easing: "cubic" },
        { to: 1, duration: POP_OUT_MS, easing: "spring" },
      ],
      false,
    );
    if (index > previous && hideTickOnThumb) {
      snapChannel(burst, 0);
      animateChannel(burst, now, [{ to: 1, duration: BURST_MS, easing: "cubic" }], false);
    }
    startLoop();
  };

  const animateStretch = (to: number): void => {
    animateChannel(
      dragStretch,
      performance.now(),
      [{ to, duration: DRAG_STRETCH_MS, easing: "cubic" }],
      prefersReducedMotion(),
    );
  };

  return {
    nodes,
    getTrackWidth: () => trackWidth,
    sync(input) {
      const isFirstSync = prevStopCount === -1;
      const countChanged = !isFirstSync && prevStopCount !== input.stops.length;
      prevStopCount = input.stops.length;
      stops = input.stops;
      fills = input.fills;
      hideTickOnThumb = input.hideTickOnThumb;
      onArrive = input.onArrive;

      if (isFirstSync || countChanged) {
        layoutTicks();
      }
      if (dragging) {
        paint();
        return;
      }
      const nextTarget = countChanged ? input.selectedIndex : input.restIndex;
      if (isFirstSync || countChanged) {
        targetIndex = nextTarget;
        liveIndex = nextTarget;
        snapChannel(display, nextTarget);
        paint();
        return;
      }
      if (nextTarget === targetIndex) {
        paint();
        return;
      }
      targetIndex = nextTarget;
      liveIndex = nextTarget;
      animateChannel(
        display,
        performance.now(),
        [{ to: nextTarget, duration: MOVE_MS, easing: "cubic" }],
        prefersReducedMotion(),
      );
      startLoop();
    },
    setTrackWidth(nextWidth) {
      const resolved = nextWidth > TRACK_HEIGHT ? nextWidth : DEFAULT_TRACK_WIDTH;
      if (Math.abs(resolved - trackWidth) < 0.5) {
        return false;
      }
      trackWidth = resolved;
      lastShellD = "";
      layoutTicks();
      paint();
      return true;
    },
    setLabelWidth(measured) {
      const resolved = measured > 0 ? measured : INITIAL_LABEL_WIDTH;
      if (!hasMeasuredLabel) {
        hasMeasuredLabel = true;
        labelWidth = resolved;
        snapChannel(plateau, plateauFor(resolved));
        paint();
        return;
      }
      if (Math.abs(resolved - labelWidth) < 0.4) {
        return;
      }
      labelWidth = resolved;
      animateChannel(
        plateau,
        performance.now(),
        [{ to: plateauFor(resolved), duration: PLATEAU_MS, easing: "cubic" }],
        prefersReducedMotion(),
      );
      startLoop();
    },
    beginDrag() {
      dragging = true;
      animateStretch(1);
      startLoop();
    },
    moveDrag(position) {
      snapChannel(display, position);
      arrive(clamp(Math.round(position), 0, Math.max(0, stops.length - 1)));
      startLoop();
    },
    endDrag() {
      dragging = false;
      animateStretch(0);
      startLoop();
      return display.value;
    },
    cancelDrag(restIndex) {
      dragging = false;
      targetIndex = restIndex;
      animateStretch(0);
      animateChannel(
        display,
        performance.now(),
        [{ to: restIndex, duration: MOVE_MS, easing: "cubic" }],
        prefersReducedMotion(),
      );
      arrive(restIndex);
      startLoop();
    },
    settleTo(nextTarget) {
      targetIndex = nextTarget;
      animateChannel(
        display,
        performance.now(),
        [{ to: nextTarget, duration: MOVE_MS, easing: "cubic" }],
        prefersReducedMotion(),
      );
      arrive(nextTarget);
      startLoop();
    },
    destroy() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    },
  };
}
