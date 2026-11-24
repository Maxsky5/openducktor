import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import {
  createStepTrackAnimator,
  DEFAULT_TRACK_WIDTH,
  fillStrengthFor,
  INITIAL_LABEL_WIDTH,
  SPEED_STREAKS,
  type StepTrackAnimator,
  type StepTrackFillLike,
  type StepTrackStopLike,
} from "./step-track-animator";
import {
  BUMP_HEIGHT,
  centerFor,
  EDGE_PAD,
  findNextEnabled,
  nearestEnabled,
  plateauFor,
  shellPath,
  THUMB_HEIGHT,
  TRACK_HEIGHT,
  thumbBounds,
  tickHeight,
  valueAt,
} from "./step-track-geometry";
import "./step-track-slider.css";

export type StepTrackSliderStop = StepTrackStopLike;
export type StepTrackSliderFill = StepTrackFillLike;

const DRAG_THRESHOLD_PX = 4;
const TOTAL_HEIGHT = BUMP_HEIGHT + TRACK_HEIGHT;

type PointerSession = {
  pointerId: number;
  startX: number;
  trackLeft: number;
  trackWidth: number;
  dragging: boolean;
};

type ScopedIndex = {
  index: number;
  forValue: string;
  forCount: number;
};

const matchesScope = (
  entry: ScopedIndex | null,
  value: string,
  count: number,
): entry is ScopedIndex =>
  entry !== null && entry.forValue === value && entry.forCount === count && entry.index < count;

const releaseCaptureSafely = (element: HTMLDivElement | null, pointerId: number): void => {
  if (!element) {
    return;
  }
  try {
    if (element.hasPointerCapture?.(pointerId)) {
      element.releasePointerCapture?.(pointerId);
    }
  } catch {
    // Ignore synthetic test pointer cleanup failures.
  }
};

const resolveKeyboardTarget = (
  key: string,
  restIndex: number,
  count: number,
  disabledStops: readonly boolean[],
): number | null | undefined => {
  if (key === "ArrowRight" || key === "ArrowUp")
    return findNextEnabled(restIndex, 1, disabledStops);
  if (key === "ArrowLeft" || key === "ArrowDown")
    return findNextEnabled(restIndex, -1, disabledStops);
  if (key === "Home") return findNextEnabled(-1, 1, disabledStops);
  if (key === "End") return findNextEnabled(count, -1, disabledStops);
  return undefined;
};

function StepTrackSvg({
  animator,
  gradientId,
  trackWidth,
  fills,
  stopCount,
  restIndex,
}: {
  animator: StepTrackAnimator;
  gradientId: string;
  trackWidth: number;
  fills: readonly StepTrackSliderFill[];
  stopCount: number;
  restIndex: number;
}): ReactElement {
  const initialCx = centerFor(restIndex, stopCount, trackWidth);
  const initialBounds = thumbBounds(initialCx, 0, trackWidth);
  const initialShellD = shellPath(initialCx, 1, plateauFor(INITIAL_LABEL_WIDTH), trackWidth);
  const initialFillWidth = Math.min(trackWidth, initialBounds.right + EDGE_PAD);
  const initialFillStrength = fillStrengthFor(restIndex, stopCount);
  const blendFills = fills.length > 1;

  return (
    <svg
      aria-hidden="true"
      width={trackWidth}
      height={TOTAL_HEIGHT}
      viewBox={`0 0 ${trackWidth} ${TOTAL_HEIGHT}`}
      className="pointer-events-none absolute inset-0 overflow-visible"
    >
      <defs>
        {fills.map((fill, index) => (
          <linearGradient
            // The fills list maps 1:1 to stop indices for smooth cross-fade blending.
            // react-doctor-disable-next-line react-doctor/no-array-index-as-key
            key={`${fill.from}-${fill.to}-${index}`}
            id={`${gradientId}-fill-${index}`}
            x1="0"
            y1="0"
            x2="1"
            y2="0"
          >
            <stop offset="0%" stopColor={fill.from} />
            <stop offset="100%" stopColor={fill.to} />
          </linearGradient>
        ))}
      </defs>
      <path
        ref={(node) => {
          animator.nodes.shellPath = node;
        }}
        d={initialShellD}
        fill="var(--step-track-shell)"
        strokeLinejoin="round"
        strokeWidth={0.75}
        style={{
          stroke: "var(--step-track-line)",
        }}
      />
      {fills.map((fill, index) => (
        <rect
          // The fills list maps 1:1 to stop indices for smooth cross-fade blending.
          // react-doctor-disable-next-line react-doctor/no-array-index-as-key
          key={`${fill.from}-${fill.to}-${index}`}
          ref={(node) => {
            animator.nodes.fillRects[index] = node;
          }}
          x={0}
          y={BUMP_HEIGHT}
          height={TRACK_HEIGHT}
          rx={TRACK_HEIGHT / 2}
          width={initialFillWidth}
          opacity={
            (blendFills ? Math.max(0, 1 - Math.abs(restIndex - index)) : 1) * initialFillStrength
          }
          fill={`url(#${gradientId}-fill-${index})`}
        />
      ))}
    </svg>
  );
}

/** Observes track and label size once on mount and re-measures label width when text changes. */
function useStepTrackLayout({
  animator,
  trackRef,
  activeLabel,
  setTrackWidth,
}: {
  animator: StepTrackAnimator;
  trackRef: React.RefObject<HTMLDivElement | null>;
  activeLabel: string;
  setTrackWidth: (width: number) => void;
}): void {
  useLayoutEffect(() => {
    const trackEl = trackRef.current;
    const labelEl = animator.nodes.label;
    if (!trackEl) {
      return;
    }
    const measureTrack = (nextWidth: number) => {
      if (animator.setTrackWidth(nextWidth)) {
        setTrackWidth(animator.getTrackWidth());
      }
    };
    measureTrack(trackEl.getBoundingClientRect().width || trackEl.clientWidth);
    if (labelEl) {
      animator.setLabelWidth(labelEl.getBoundingClientRect().width || labelEl.offsetWidth);
    }
    const ObserverCtor = globalThis.ResizeObserver;
    if (!ObserverCtor) {
      return;
    }
    const observer = new ObserverCtor((entries) => {
      for (const entry of entries) {
        if (entry.target === trackEl) {
          measureTrack(entry.contentRect.width);
        } else if (entry.target === labelEl) {
          animator.setLabelWidth(entry.contentRect.width);
        }
      }
    });
    observer.observe(trackEl);
    if (labelEl) {
      observer.observe(labelEl);
    }
    return () => observer.disconnect();
  }, [animator, setTrackWidth, trackRef]);

  useLayoutEffect(() => {
    const labelEl = animator.nodes.label;
    if (labelEl) {
      animator.setLabelWidth(labelEl.getBoundingClientRect().width || labelEl.offsetWidth);
    }
  }, [animator, activeLabel]);
}

function StepTrackOverlay({
  animator,
  stops,
  trackWidth,
  restIndex,
  liveIndex,
  hideTickOnThumb,
  renderThumbIcon,
}: {
  animator: StepTrackAnimator;
  stops: readonly StepTrackSliderStop[];
  trackWidth: number;
  restIndex: number;
  liveIndex: number;
  hideTickOnThumb: boolean;
  renderThumbIcon: ((stop: StepTrackSliderStop, index: number) => ReactNode) | undefined;
}): ReactElement {
  const count = stops.length;
  const activeStop = stops[liveIndex] ?? stops[restIndex];
  return (
    <>
      {hideTickOnThumb
        ? SPEED_STREAKS.map((streak, index) => (
            <span
              key={streak.y}
              ref={(node) => {
                animator.nodes.streaks[index] = node;
              }}
              aria-hidden="true"
              className="step-track-streak pointer-events-none absolute left-0 h-[2px] rounded-full opacity-0"
              style={{
                width: `${streak.width}px`,
                top: `${BUMP_HEIGHT + TRACK_HEIGHT / 2 + streak.y - 1}px`,
              }}
            />
          ))
        : null}

      <div
        ref={(node) => {
          animator.nodes.thumb = node;
        }}
        aria-hidden="true"
        className="step-track-thumb pointer-events-none absolute left-0 flex items-center justify-center rounded-full"
        style={{ top: `${BUMP_HEIGHT + EDGE_PAD}px`, height: `${THUMB_HEIGHT}px` }}
      >
        {renderThumbIcon && activeStop ? (
          <span
            ref={(node) => {
              animator.nodes.mark = node;
            }}
            className="inline-flex items-center justify-center"
          >
            {renderThumbIcon(activeStop, liveIndex)}
          </span>
        ) : null}
      </div>

      {stops.map((stop, index) => {
        const height = tickHeight(index, count);
        return (
          <span
            key={stop.value}
            ref={(node) => {
              animator.nodes.ticks[index] = node;
            }}
            aria-hidden="true"
            className="pointer-events-none absolute w-[1.5px] rounded-full"
            style={{
              height: `${height}px`,
              top: `${BUMP_HEIGHT + (TRACK_HEIGHT - height) / 2}px`,
            }}
          />
        );
      })}

      <div
        ref={(node) => {
          animator.nodes.label = node;
        }}
        aria-hidden="true"
        className="step-track-label pointer-events-none absolute left-0 top-[3px] whitespace-nowrap"
        style={{ maxWidth: `${Math.max(48, trackWidth - 48)}px` }}
      >
        <span
          key={activeStop?.label ?? ""}
          className="step-track-label-swap block truncate text-[11px] font-medium leading-[14px] tracking-[-0.01em]"
        >
          {activeStop?.label ?? ""}
        </span>
      </div>
    </>
  );
}

export type StepTrackSliderProps = {
  stops: readonly StepTrackSliderStop[];
  value: string;
  fills: readonly StepTrackSliderFill[];
  ariaLabel: string;
  ariaDescribedBy?: string | undefined;
  disabled?: boolean | undefined;
  busy?: boolean | undefined;
  renderThumbIcon?: ((stop: StepTrackSliderStop, index: number) => ReactNode) | undefined;
  onChange: (value: string) => Promise<void> | void;
  onActiveStopChange?: ((stop: StepTrackSliderStop, index: number) => void) | undefined;
  sliderRef?: ((element: HTMLDivElement | null) => void) | undefined;
};

export function StepTrackSlider({
  stops,
  value,
  fills,
  ariaLabel,
  ariaDescribedBy,
  disabled = false,
  busy = false,
  renderThumbIcon,
  onChange,
  onActiveStopChange,
  sliderRef,
}: StepTrackSliderProps): ReactElement {
  const gradientId = useId().replace(/:/g, "");
  const count = stops.length;
  const selectedIndex = Math.max(
    0,
    stops.findIndex((stop) => stop.value === value),
  );
  const disabledStops = useMemo(() => stops.map((stop) => stop.disabled === true), [stops]);
  const [requested, setRequested] = useState<ScopedIndex | null>(null);
  const [preview, setPreview] = useState<ScopedIndex | null>(null);
  const [trackWidth, setTrackWidth] = useState(DEFAULT_TRACK_WIDTH);
  const [animator] = useState(() => createStepTrackAnimator(selectedIndex));

  const restIndex = matchesScope(requested, value, count) ? requested.index : selectedIndex;
  const liveIndex = matchesScope(preview, value, count) ? preview.index : restIndex;
  const activeLabel = (stops[liveIndex] ?? stops[restIndex])?.label ?? "";
  const interactive = !disabled && count > 1;
  const hideTickOnThumb = renderThumbIcon !== undefined;

  const trackRef = useRef<HTMLDivElement | null>(null);
  const pointerRef = useRef<PointerSession | null>(null);

  useEffect(() => () => animator.destroy(), [animator]);
  useStepTrackLayout({ animator, trackRef, activeLabel, setTrackWidth });

  useLayoutEffect(() => {
    animator.sync({
      stops,
      fills,
      hideTickOnThumb,
      restIndex,
      selectedIndex,
      onArrive: (index) => {
        setPreview({ index, forValue: value, forCount: count });
        const stop = stops[index];
        if (stop) {
          onActiveStopChange?.(stop, index);
        }
      },
    });
  }, [
    animator,
    count,
    fills,
    hideTickOnThumb,
    onActiveStopChange,
    restIndex,
    selectedIndex,
    stops,
    value,
  ]);

  const setCombinedRef = useCallback(
    (node: HTMLDivElement | null) => {
      trackRef.current = node;
      sliderRef?.(node);
    },
    [sliderRef],
  );

  const commitIndex = useCallback(
    (targetIndex: number | null) => {
      if (targetIndex === null) {
        return;
      }
      const nextStop = stops[targetIndex];
      if (!nextStop || nextStop.disabled) {
        return;
      }
      animator.settleTo(targetIndex);
      if (nextStop.value === value) {
        setRequested(null);
        setPreview(null);
        return;
      }
      const pending: ScopedIndex = { index: targetIndex, forValue: value, forCount: count };
      setRequested(pending);
      void Promise.resolve(onChange(nextStop.value)).finally(() => {
        setRequested((current) => (current === pending ? null : current));
        setPreview((current) => (matchesScope(current, value, count) ? null : current));
      });
    },
    [animator, count, onChange, stops, value],
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const element = trackRef.current;
    if (!interactive || event.button !== 0 || !element) {
      return;
    }
    event.preventDefault();
    element.focus();
    const rect = element.getBoundingClientRect();
    animator.setTrackWidth(rect.width);
    pointerRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      trackLeft: rect.left,
      trackWidth: animator.getTrackWidth(),
      dragging: false,
    };
    try {
      element.setPointerCapture?.(event.pointerId);
    } catch {
      // Ignore synthetic test pointers without active browser pointer capture.
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const session = pointerRef.current;
    if (!interactive || !session || session.pointerId !== event.pointerId) {
      return;
    }
    if (!session.dragging) {
      if (Math.abs(event.clientX - session.startX) < DRAG_THRESHOLD_PX) {
        return;
      }
      session.dragging = true;
      animator.beginDrag();
    }
    animator.moveDrag(valueAt(event.clientX - session.trackLeft, count, session.trackWidth));
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const session = pointerRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    pointerRef.current = null;
    releaseCaptureSafely(trackRef.current, event.pointerId);
    if (session.dragging) {
      commitIndex(nearestEnabled(Math.round(animator.endDrag()), disabledStops));
      return;
    }
    const target = nearestEnabled(
      Math.round(valueAt(event.clientX - session.trackLeft, count, session.trackWidth)),
      disabledStops,
    );
    commitIndex(target);
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const session = pointerRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    pointerRef.current = null;
    releaseCaptureSafely(trackRef.current, event.pointerId);
    if (session.dragging) {
      setPreview(null);
      animator.cancelDrag(restIndex);
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!interactive) {
      return;
    }
    const target = resolveKeyboardTarget(event.key, restIndex, count, disabledStops);
    if (target === undefined) {
      return;
    }
    event.preventDefault();
    commitIndex(target);
  };

  return (
    <div
      ref={setCombinedRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, count - 1)}
      aria-valuenow={restIndex}
      aria-valuetext={stops[restIndex]?.label ?? value}
      aria-disabled={disabled}
      aria-busy={busy}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onKeyDown={handleKeyDown}
      style={{ height: `${TOTAL_HEIGHT}px` }}
      className={cn(
        "step-track-slider group relative w-full focus-visible:outline-none",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 rounded-full group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-1 group-focus-visible:ring-offset-popover"
        style={{ top: `${BUMP_HEIGHT}px`, height: `${TRACK_HEIGHT}px` }}
      />
      <StepTrackSvg
        animator={animator}
        gradientId={gradientId}
        trackWidth={trackWidth}
        fills={fills}
        stopCount={count}
        restIndex={restIndex}
      />
      <StepTrackOverlay
        animator={animator}
        stops={stops}
        trackWidth={trackWidth}
        restIndex={restIndex}
        liveIndex={liveIndex}
        hideTickOnThumb={hideTickOnThumb}
        renderThumbIcon={renderThumbIcon}
      />
    </div>
  );
}
