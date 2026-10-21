import type { BrowserBox } from "@openducktor/contracts";
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  useEffect,
  useId,
  useRef,
} from "react";
import { cn } from "@/lib/utils";

export type BrowserPickerTarget = { box: BrowserBox; label: string };

export type BrowserPickerOverlayProps = {
  /** The element under the pointer, from the host, or null. */
  target: BrowserPickerTarget | null;
  /** The boxes of the selected elements. */
  selected: readonly BrowserBox[];
  /** The pointer position in CSS pixels of the page area. At most once per animation frame. */
  onPointerMove: (x: number, y: number) => void;
  /** A click at a point of the page area. Shift-click adds or removes an element. */
  onPick: (shiftKey: boolean, x: number, y: number) => void;
  /** Escape turns the picker off. */
  onCancel: () => void;
};

/** A pointer position in CSS pixels of the page area. */
const pagePoint = (event: MouseEvent<HTMLDivElement>) => {
  const area = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - area.left, y: event.clientY - area.top };
};

/** The label sits above the box when there is room, and inside the box at the top edge. */
const LABEL_HEIGHT = 20;

const boxStyle = (box: BrowserBox): CSSProperties => ({
  left: box.x,
  top: box.y,
  width: box.width,
  height: box.height,
});

/**
 * Covers the page area while the element picker is on. It takes every pointer event, so page code
 * never sees them, and it draws the highlight and the selection over the page.
 */
export function BrowserPickerOverlay({
  target,
  selected,
  onPointerMove,
  onPick,
  onCancel,
}: BrowserPickerOverlayProps): ReactElement {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const pointRef = useRef<{ x: number; y: number } | null>(null);
  const hintId = useId();

  useEffect(() => {
    overlayRef.current?.focus({ preventScroll: true });
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    pointRef.current = pagePoint(event);
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const point = pointRef.current;
      pointRef.current = null;
      if (point) onPointerMove(point.x, point.y);
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  };

  return (
    <div
      ref={overlayRef}
      role="application"
      aria-label="Element picker"
      aria-describedby={hintId}
      tabIndex={-1}
      data-testid="browser-picker-overlay"
      className="pointer-events-auto absolute inset-0 z-10 cursor-crosshair overflow-hidden outline-none"
      onPointerMove={handlePointerMove}
      onClick={(event) => {
        event.preventDefault();
        const point = pagePoint(event);
        onPick(event.shiftKey, point.x, point.y);
      }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handleKeyDown}
    >
      <span id={hintId} className="sr-only">
        Click an element to annotate it. Shift-click adds or removes an element. Press Escape to
        stop.
      </span>
      {selected.map((box, index) => (
        <div
          // The selection has no IDs, and its order is stable while it shows.
          key={index}
          aria-hidden="true"
          data-testid="browser-picker-selected"
          className="pointer-events-none absolute rounded-[2px] bg-sky-400/15 outline-2 outline-sky-600"
          style={boxStyle(box)}
        />
      ))}
      {target ? (
        <div
          aria-hidden="true"
          data-testid="browser-picker-target"
          className="pointer-events-none absolute rounded-[2px] border border-sky-500 bg-sky-400/25"
          style={boxStyle(target.box)}
        >
          <span
            className={cn(
              "absolute left-0 max-w-64 truncate rounded-sm bg-sky-300 px-1.5 text-[11px] leading-5 font-medium text-neutral-950 shadow-sm",
              target.box.y >= LABEL_HEIGHT ? "-top-[21px]" : "top-0",
            )}
          >
            {target.label}
          </span>
        </div>
      ) : null}
    </div>
  );
}
