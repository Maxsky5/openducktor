"use client";
import { type NodeMouseHandler, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import "./flow.css";
import "./nodes.css";
import { type CSSProperties, useCallback, useId, useMemo, useState } from "react";
import { NODE_TYPES } from "./nodes";
import type { Diagram, FlowLayout } from "./spec";

declare module "react" {
  interface CSSProperties {
    /** The width of a diagram layout. `flow.css` scales the layout from it. */
    "--docs-flow-width"?: string;
  }
}

const PRO_OPTIONS = { hideAttribution: true };
/** React Flow stays at zoom 1. CSS scales the viewport to the width of the article. */
const VIEWPORT = { x: 0, y: 0, zoom: 1 };

/**
 * One layout of a diagram. Its box has the shape of the layout from the first paint. The edge
 * labels are HTML over the canvas, so the server draws them too.
 */
function FlowCanvas({ layout, className }: { layout: FlowLayout; className: string }) {
  // Each canvas needs its own id, so its edges use its own arrow markers.
  const id = useId();
  const [hovered, setHovered] = useState<string | null>(null);
  const edges = useMemo(
    () =>
      hovered === null
        ? layout.edges
        : layout.edges.map((line) =>
            line.source === hovered || line.target === hovered
              ? { ...line, className: `${line.className ?? ""} is-active` }
              : line,
          ),
    [layout.edges, hovered],
  );
  const onNodeMouseEnter = useCallback<NodeMouseHandler>((_, node) => setHovered(node.id), []);
  const onNodeMouseLeave = useCallback(() => setHovered(null), []);
  const style: CSSProperties = {
    "--docs-flow-width": `${layout.width}px`,
    maxWidth: layout.width,
    aspectRatio: `${layout.width} / ${layout.height}`,
  };
  return (
    <div className={`docs-flow-canvas ${className}`} style={style}>
      <ReactFlow
        id={id}
        proOptions={PRO_OPTIONS}
        nodes={layout.nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        viewport={VIEWPORT}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
      />
      <div className="docs-flow-labels" aria-hidden="true">
        {layout.labels.map((label) => (
          <span
            key={label.id}
            className="docs-flow-label"
            data-kind={label.kind}
            data-vertical={label.vertical ? "" : undefined}
            style={{ left: label.x, top: label.y }}
          >
            {label.text}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * A diagram drawn with React Flow, with a wide layout and a phone layout. The canvas does not pan
 * or zoom, and pointing to a node lights its lines. A container query shows the layout that fits
 * the article, so the server draws both and the page keeps its height.
 */
export function FlowDiagram({ diagram }: { diagram: Diagram }) {
  return (
    <figure className="docs-diagram docs-flow not-prose" role="img" aria-label={diagram.label}>
      <FlowCanvas layout={diagram.wide} className="docs-flow-wide" />
      <FlowCanvas layout={diagram.narrow} className="docs-flow-narrow" />
    </figure>
  );
}
