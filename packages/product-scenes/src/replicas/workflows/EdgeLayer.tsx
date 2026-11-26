// The transition lines of the workflow canvas: EventEdge of canvas/event-edge.tsx in
// packages/frontend/src/features/workflows/editor. Each line is a React Flow BaseEdge with the
// closed arrowhead of use-canvas-elements.ts, and its label is a pill with the icon of its
// trigger. A line without a trigger is dotted, and its pill is dashed with a problem marker. The
// selected line shows a grip at each end, and the line of a new transition follows the pointer
// while the user drags it. A scene sets `d`, `data-emphasis`, and `data-untriggered` on a line,
// the label box in `--lx`, `--ly`, and `--lw`, `hidden` on the grips, and `data-dragging` on the
// line of a new transition while it follows the pointer.
import { AlertTriangle, CircleDashed, MousePointerClick } from "lucide-react";
import type { CSSProperties, ReactElement } from "react";
import { flag } from "../flag";
import type { Point } from "../../motion/offset";
import { ARROW, type Box, type CanvasLine, type LineRoute } from "./model";
import "./EdgeLayer.css";

/**
 * The closed arrowhead of React Flow: MarkerType.ArrowClosed in 30 user units, as `marker` of
 * use-canvas-elements.ts gives it.
 */
function Arrowhead({ id }: { id: string }): ReactElement {
  return (
    <marker
      id={id}
      className="wfe-arrowhead"
      markerWidth="30"
      markerHeight="30"
      viewBox="-10 -10 20 20"
      markerUnits="userSpaceOnUse"
      orient="auto-start-reverse"
      refX="0"
      refY="0"
    >
      <polyline strokeLinecap="round" strokeLinejoin="round" points="-5,-4 0,0 -5,4 -5,-4" />
    </marker>
  );
}

type EdgeLinesProps = {
  lines: readonly CanvasLine[];
  routes: Readonly<Record<string, LineRoute>>;
};

/** The paths of the lines in flow coordinates, with the line of a new transition. */
export function EdgeLines({ lines, routes }: EdgeLinesProps): ReactElement {
  return (
    <svg className="wfe-lines" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <Arrowhead id={ARROW.normal} />
        <Arrowhead id={ARROW.emphasized} />
      </defs>
      {lines.map((line) => (
        <path
          key={line.id}
          className="wfe-line"
          data-line={line.id}
          data-untriggered={flag(!line.triggered)}
          d={routes[line.id]?.path}
          markerEnd={`url(#${ARROW.normal})`}
        />
      ))}
      <path className="wfe-connection" data-connection="" d="M 0 0" />
    </svg>
  );
}

/** The place and the size of a label box in flow coordinates. */
function labelPlace(box: Box): CSSProperties & Record<"--lx" | "--ly" | "--lw", number> {
  return { "--lx": box.x, "--ly": box.y, "--lw": box.width };
}

type EdgeLabelProps = { line: CanvasLine; box: Box | undefined };

/** EdgeLabel: the one-line label of a line, with the icon of its trigger or a dashed circle. */
export function EdgeLabel({ line, box }: EdgeLabelProps): ReactElement {
  return (
    <span
      className="wfe-label"
      data-label={line.id}
      data-untriggered={flag(!line.triggered)}
      style={box ? labelPlace(box) : undefined}
    >
      <CircleDashed className="wfe-label-dashed" />
      <MousePointerClick className="wfe-label-button" />
      <span className="wfe-label-text">{line.text}</span>
      <AlertTriangle className="wfe-label-marker" />
    </span>
  );
}

/** The round grips at the ends of the selected line, which a drag moves to another state. */
export function EdgeGrips({ ends }: { ends: readonly [Point, Point] }): ReactElement {
  return (
    <>
      {ends.map((end, index) => {
        const place: CSSProperties & Record<"--x" | "--y", number> = { "--x": end.x, "--y": end.y };
        return <span className="wfe-grip" data-grip={index} style={place} key={index} hidden />;
      })}
    </>
  );
}
