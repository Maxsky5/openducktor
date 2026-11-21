import { EdgeLabelRenderer, useReactFlow } from "@xyflow/react";
import { type PointerEvent, type ReactElement, useState } from "react";
import { cn } from "@/lib/utils";
import { useEditor } from "../editor-context";
import { reconnectEvent, type TransitionEnd } from "../model/create-elements";
import type { Point } from "./canvas-geometry";

type Drag = {
  readonly end: TransitionEnd;
  /** The pointer, or the center of the state under it, in flow coordinates. */
  readonly point: Point;
  /** The state under the pointer, when it can take the end. */
  readonly over: string | null;
};

/** The state box under a screen point. The dragged grip under the pointer does not count. */
const stateAt = (x: number, y: number): string | null => {
  for (const element of document.elementsFromPoint(x, y)) {
    const node = element.closest(".react-flow__node");
    if (node) return node.getAttribute("data-id");
  }
  return null;
};

/**
 * Drags one end of a transition line onto another state. While a drag runs, a dashed line runs
 * from the fixed end to the pointer, or to the center of the state that would take the end.
 */
export const useEndDrag = ({
  eventId,
  source,
  target,
}: {
  eventId: string;
  source: string;
  target: string;
}) => {
  const { store } = useEditor();
  const { screenToFlowPosition, getInternalNode } = useReactFlow();
  const [drag, setDrag] = useState<Drag | null>(null);
  const current = (end: TransitionEnd) => (end === "source" ? source : target);

  const follow = (end: TransitionEnd, event: PointerEvent) => {
    const id = stateAt(event.clientX, event.clientY);
    const node = id === null || id === current(end) ? undefined : getInternalNode(id);
    const point = node
      ? {
          x: node.internals.positionAbsolute.x + (node.measured.width ?? 0) / 2,
          y: node.internals.positionAbsolute.y + (node.measured.height ?? 0) / 2,
        }
      : screenToFlowPosition({ x: event.clientX, y: event.clientY });
    setDrag({ end, point, over: node ? node.id : null });
  };

  const handlers = (end: TransitionEnd) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      follow(end, event);
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      if (drag?.end === end) follow(end, event);
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      event.currentTarget.releasePointerCapture(event.pointerId);
      const over = drag?.end === end ? drag.over : null;
      setDrag(null);
      if (over !== null)
        store
          .getState()
          .change((document) => reconnectEvent(document, eventId, end, current(end), over));
    },
    onPointerCancel: () => setDrag(null),
  });

  return { drag, handlers };
};

/** The dashed line of a running drag, from the end that stays. */
export function EndDragPreview({
  drag,
  ends,
}: {
  drag: Drag;
  ends: readonly [Point, Point];
}): ReactElement {
  const fixed = drag.end === "source" ? ends[1] : ends[0];
  return (
    <path
      className={cn("workflow-edge-preview", drag.over !== null && "is-over-state")}
      d={`M ${fixed.x} ${fixed.y} L ${drag.point.x} ${drag.point.y}`}
    />
  );
}

/** The two round grips at the ends of the selected transition line. */
export function EdgeEndHandles({
  ends,
  sourceMovable,
  drag,
  handlers,
}: {
  ends: readonly [Point, Point];
  /** The running drag. Its grip follows the pointer. */
  drag: Drag | null;
  /** False for a transition from many states, whose drawn source stands for all of them. */
  sourceMovable: boolean;
  handlers: ReturnType<typeof useEndDrag>["handlers"];
}): ReactElement {
  const grips = [
    {
      end: "source" as const,
      point: ends[0],
      label: "Drag onto another state to change where the transition starts",
      shown: sourceMovable,
    },
    {
      end: "target" as const,
      point: ends[1],
      label: "Drag onto another state to change where the transition goes",
      shown: true,
    },
  ].filter(({ shown }) => shown);
  return (
    <EdgeLabelRenderer>
      {grips.map(({ end, point: rest, label }) => {
        const point = drag?.end === end ? drag.point : rest;
        return (
          <button
            tabIndex={-1}
            aria-hidden="true"
            key={end}
            type="button"
            aria-label={label}
            title={label}
            className="workflow-edge-grip nodrag nopan pointer-events-auto absolute"
            style={{ transform: `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)` }}
            {...handlers(end)}
          />
        );
      })}
    </EdgeLabelRenderer>
  );
}
