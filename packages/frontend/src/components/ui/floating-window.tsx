import {
  createContext,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import "./floating-window.css";

/** The place and size of a floating window, in CSS pixels of the viewport. */
export type FloatingWindowRect = { x: number; y: number; width: number; height: number };

type FloatingWindowLayerValue = {
  container: HTMLElement | null;
  /** The stack order of a window. The window that the user touched last is on top. */
  orderOf(id: string): number;
  raise(id: string): void;
};

const FloatingWindowLayerContext = createContext<FloatingWindowLayerValue | null>(null);

/**
 * The layer of the floating windows. It sits above the pages and below sheets, dialogs, and
 * popovers, and it stays across navigation, so a window keeps its place while the user works.
 */
export function FloatingWindowLayer({ children }: PropsWithChildren): ReactElement {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [stack, setStack] = useState<readonly string[]>([]);
  const raise = useCallback((id: string) => {
    setStack((current) =>
      current.at(-1) === id ? current : [...current.filter((entry) => entry !== id), id],
    );
  }, []);
  const orderOf = useCallback((id: string) => Math.max(0, stack.indexOf(id)), [stack]);
  const value = useMemo(() => ({ container, orderOf, raise }), [container, orderOf, raise]);
  return (
    <FloatingWindowLayerContext value={value}>
      {children}
      <div ref={setContainer} className="pointer-events-none fixed inset-0 z-40" />
    </FloatingWindowLayerContext>
  );
}

/** The part of a window that the user can see at least, so a window never gets lost. */
const VISIBLE_EDGE = 96;
const TITLE_HEIGHT = 40;
const VIEWPORT_MARGIN = 8;

/** Keeps the title bar of a window inside the viewport, and the window not larger than it. */
const clampRect = (rect: FloatingWindowRect, min: Size): FloatingWindowRect => {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(Math.max(rect.width, min.width), viewportWidth - VIEWPORT_MARGIN * 2);
  const height = Math.min(Math.max(rect.height, min.height), viewportHeight - VIEWPORT_MARGIN * 2);
  const x = Math.min(Math.max(rect.x, VISIBLE_EDGE - width), viewportWidth - VISIBLE_EDGE);
  const y = Math.min(Math.max(rect.y, VIEWPORT_MARGIN), viewportHeight - TITLE_HEIGHT);
  return { x, y, width, height };
};

type Size = { width: number; height: number };

/** The edges that a resize moves. A corner moves two. */
type Edges = { left: boolean; right: boolean; top: boolean; bottom: boolean };

/**
 * The rect after a resize by `dx` and `dy`. The edges that the gesture holds move, inside the
 * viewport, and the opposite edges stay, so the window never gets smaller than its minimum size.
 */
const resizeRect = (
  start: FloatingWindowRect,
  edges: Edges,
  dx: number,
  dy: number,
  min: Size,
): FloatingWindowRect => {
  const startRight = start.x + start.width;
  const startBottom = start.y + start.height;
  let left = start.x;
  let right = startRight;
  let top = start.y;
  let bottom = startBottom;
  if (edges.left) left = Math.min(Math.max(start.x + dx, VIEWPORT_MARGIN), startRight - min.width);
  if (edges.right)
    right = Math.max(
      Math.min(startRight + dx, window.innerWidth - VIEWPORT_MARGIN),
      left + min.width,
    );
  if (edges.top) top = Math.min(Math.max(start.y + dy, VIEWPORT_MARGIN), startBottom - min.height);
  if (edges.bottom)
    bottom = Math.max(
      Math.min(startBottom + dy, window.innerHeight - VIEWPORT_MARGIN),
      top + min.height,
    );
  return { x: left, y: top, width: right - left, height: bottom - top };
};

/** The resize handles: each edge, and each corner on top of the edges. */
const RESIZE_HANDLES: readonly { name: string; edges: Edges; className: string }[] = [
  { name: "n", edges: edge("top"), className: "-top-1 right-3 left-3 h-2 cursor-ns-resize" },
  { name: "e", edges: edge("right"), className: "top-3 -right-1 bottom-3 w-2 cursor-ew-resize" },
  { name: "s", edges: edge("bottom"), className: "right-3 -bottom-1 left-3 h-2 cursor-ns-resize" },
  { name: "w", edges: edge("left"), className: "top-3 bottom-3 -left-1 w-2 cursor-ew-resize" },
  { name: "nw", edges: edge("top", "left"), className: "-top-1 -left-1 size-3 cursor-nwse-resize" },
  {
    name: "ne",
    edges: edge("top", "right"),
    className: "-top-1 -right-1 size-3 cursor-nesw-resize",
  },
  {
    name: "se",
    edges: edge("bottom", "right"),
    className: "-right-1 -bottom-1 size-4 cursor-nwse-resize",
  },
  {
    name: "sw",
    edges: edge("bottom", "left"),
    className: "-bottom-1 -left-1 size-3 cursor-nesw-resize",
  },
];

function edge(...held: (keyof Edges)[]): Edges {
  return {
    left: held.includes("left"),
    right: held.includes("right"),
    top: held.includes("top"),
    bottom: held.includes("bottom"),
  };
}

type Gesture = {
  kind: "move" | "resize";
  edges: Edges;
  pointerX: number;
  pointerY: number;
  start: FloatingWindowRect;
  rect: FloatingWindowRect;
};

type PointerHandlers = Pick<
  HTMLAttributes<HTMLElement>,
  "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel"
>;

type FloatingWindowProps = {
  id: string;
  /** The name in the title bar, which screen readers also give the window. */
  title: string;
  icon?: ReactNode;
  /** Buttons of the owner, before Close, such as one that attaches the window back. */
  actions?: ReactNode;
  onClose: () => void;
  rect: FloatingWindowRect;
  onRectChange: (rect: FloatingWindowRect) => void;
  minSize?: Size;
  children: ReactNode;
};

const DEFAULT_MIN_SIZE: Size = { width: 360, height: 240 };

/** True for a button of the title bar, which keeps its own clicks. */
const isControl = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest("button, a, [role=button]") !== null;

const NO_EDGES = edge();

/**
 * A window that floats above the app without blocking it. It has its own title bar: the user
 * moves the window by it, resizes the window from any edge or corner, and
 * brings it to the front with a click. It stays in the viewport when the viewport shrinks. The
 * owner gives the content and keeps the place and size.
 */
export function FloatingWindow({
  id,
  title,
  icon,
  actions,
  onClose,
  rect,
  onRectChange,
  minSize = DEFAULT_MIN_SIZE,
  children,
}: FloatingWindowProps): ReactElement | null {
  const layer = useContext(FloatingWindowLayerContext);
  const windowRef = useRef<HTMLDialogElement | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  // The handlers stay the same between renders, so they read the latest props here.
  const latest = useRef({ rect, minSize, onRectChange });
  useEffect(() => {
    latest.current = { rect, minSize, onRectChange };
  });
  const [gesture, setGesture] = useState<Gesture["kind"] | null>(null);
  const raise = layer?.raise;

  useEffect(() => {
    raise?.(id);
  }, [id, raise]);

  // A smaller viewport moves the window back into it.
  useEffect(() => {
    const keepInView = () => {
      const current = latest.current;
      const clamped = clampRect(current.rect, current.minSize);
      const { rect: last } = current;
      if (
        clamped.x !== last.x ||
        clamped.y !== last.y ||
        clamped.width !== last.width ||
        clamped.height !== last.height
      )
        current.onRectChange(clamped);
    };
    keepInView();
    window.addEventListener("resize", keepInView);
    return () => window.removeEventListener("resize", keepInView);
  }, []);

  const handlersFor = useCallback(
    (kind: Gesture["kind"], edges: Gesture["edges"]): PointerHandlers => {
      // A gesture writes the style at once, and the owner gets the result when it ends.
      const paint = (next: FloatingWindowRect) => {
        const element = windowRef.current;
        if (!element) return;
        element.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`;
        element.style.width = `${next.width}px`;
        element.style.height = `${next.height}px`;
      };
      const end = (event: ReactPointerEvent<HTMLElement>) => {
        const current = gestureRef.current;
        if (!current) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        gestureRef.current = null;
        setGesture(null);
        latest.current.onRectChange(current.rect);
      };
      return {
        onPointerDown: (event) => {
          if (event.button !== 0 || (kind === "move" && isControl(event.target))) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          const start = latest.current.rect;
          gestureRef.current = {
            kind,
            edges,
            pointerX: event.clientX,
            pointerY: event.clientY,
            start,
            rect: start,
          };
          setGesture(kind);
        },
        onPointerMove: (event) => {
          const current = gestureRef.current;
          if (!current) return;
          const dx = event.clientX - current.pointerX;
          const dy = event.clientY - current.pointerY;
          const { start } = current;
          const { minSize } = latest.current;
          current.rect =
            current.kind === "move"
              ? clampRect({ ...start, x: start.x + dx, y: start.y + dy }, minSize)
              : resizeRect(start, current.edges, dx, dy, minSize);
          paint(current.rect);
        },
        onPointerUp: end,
        onPointerCancel: end,
      };
    },
    [],
  );
  const moveHandlers = useMemo(() => handlersFor("move", NO_EDGES), [handlersFor]);

  if (!layer?.container) return null;

  return createPortal(
    // A non-modal native dialog: it takes no focus and blocks nothing. The resets remove the
    // margin, padding, size limits, and colors that browsers give a dialog.
    <dialog
      ref={windowRef}
      open
      aria-label={title}
      data-floating-window={id}
      // A native browser page draws above the app, so it must leave room for the window.
      data-page-occluder=""
      data-gesture={gesture ?? undefined}
      className={cn(
        "floating-window pointer-events-auto absolute top-0 left-0 m-0 flex max-h-none max-w-none flex-col rounded-xl border border-border bg-popover p-0 text-popover-foreground outline-none",
        gesture && "select-none",
      )}
      style={{
        transform: `translate3d(${rect.x}px, ${rect.y}px, 0)`,
        width: rect.width,
        height: rect.height,
        zIndex: layer.orderOf(id) + 1,
      }}
      onPointerDownCapture={() => raise?.(id)}
    >
      <div
        className={cn(
          "flex h-9 shrink-0 items-center gap-2 rounded-t-[inherit] border-b border-border bg-muted/50 pr-1.5 pl-3 select-none",
          gesture === "move" ? "cursor-grabbing" : "cursor-grab",
        )}
        data-floating-window-title-bar=""
        {...moveHandlers}
      >
        {icon ? (
          <span className="flex shrink-0 text-muted-foreground [&_svg]:size-3.5" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground/90">
          {title}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          {actions}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            aria-label={`Close ${title}`}
            title="Close"
            onClick={onClose}
          >
            <X className="size-3.5" aria-hidden="true" />
          </Button>
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-[inherit]">
        {children}
      </div>
      {RESIZE_HANDLES.map((handle) => (
        <div
          key={handle.name}
          aria-hidden="true"
          data-resize-handle={handle.name}
          className={cn("pointer-events-auto absolute", handle.className)}
          {...handlersFor("resize", handle.edges)}
        />
      ))}
      {/* Two short strokes in the corner show that the window resizes. */}
      <span
        aria-hidden="true"
        className="floating-window-grip pointer-events-none absolute right-1.5 bottom-1.5 size-2.5 text-muted-foreground/60"
      />
    </dialog>,
    layer.container,
  );
}
