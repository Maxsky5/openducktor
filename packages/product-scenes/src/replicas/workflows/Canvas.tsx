// The canvas of the workflow editor: WorkflowCanvas of canvas/workflow-canvas.tsx in
// packages/frontend/src/features/workflows/editor. The React Flow pane with its dot grid, the
// viewport with the lines, their labels, and the state boxes, the toolbar with Add a state and
// Auto layout, and the zoom controls. The viewport pans and zooms with `--vx` from the middle of
// the pane, `--vy`, and `--zoom`, which a scene changes, as setViewport of React Flow does. The
// markup shows the viewport of `--fit-x`, `--fit-y`, and `--fit-zoom`, which a view sets. The
// narrow editor of workflow-editor.tsx puts the Elements toggle first: a view that shows the
// narrow editor shows it. MoreBelowControl of canvas-overlays.tsx shows while the workflow reaches
// past the bottom of the canvas.
import { ChevronsDown, LayoutGrid, Map as MapIcon, Maximize, PanelLeft, Plus } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "../ui/Button";
import { EdgeGrips, EdgeLabel, EdgeLines } from "./EdgeLayer";
import type { Point } from "../../motion/offset";
import type { CanvasFrame, CanvasLine, CanvasState } from "./model";
import { StateNode } from "./StateNode";
import { CANVAS_TEXT } from "./text";
import "./Canvas.css";

/** The PlusIcon and the MinusIcon of the React Flow controls. */
function FlowPlus(): ReactElement {
  return (
    <svg viewBox="0 0 32 32">
      <path d="M32 18.133H18.133V32h-4.266V18.133H0v-4.266h13.867V0h4.266v13.867H32z" />
    </svg>
  );
}

function FlowMinus(): ReactElement {
  return (
    <svg viewBox="0 0 32 5">
      <path d="M0 0h32v4.2H0z" />
    </svg>
  );
}

type CanvasProps = {
  states: readonly CanvasState[];
  lines: readonly CanvasLine[];
  frame: CanvasFrame;
  /** The ends of the selected line, where its grips show. */
  grips: readonly [Point, Point];
};

export function Canvas({ states, lines, frame, grips }: CanvasProps): ReactElement {
  return (
    <div className="wfe-canvas" data-canvas="">
      <div className="wfe-flow">
        <EdgeLines lines={lines} routes={frame.routes} />
        {lines.map((line) => (
          <EdgeLabel line={line} box={frame.routes[line.id]?.label} key={line.id} />
        ))}
        {states.map((state) => (
          <StateNode
            state={state}
            at={frame.positions[state.id] ?? { x: 0, y: 0 }}
            key={state.id}
          />
        ))}
        <EdgeGrips ends={grips} />
      </div>
      <div className="wfe-toolbar">
        <Button variant="outline" size="sm" className="wfe-tool wfe-elements">
          <PanelLeft className="i14" />
          {CANVAS_TEXT.elements}
        </Button>
        <Button variant="outline" size="sm" className="wfe-tool" data-add-state="">
          <Plus className="i14" />
          {CANVAS_TEXT.addState}
        </Button>
        <Button variant="outline" size="sm" className="wfe-tool">
          <LayoutGrid className="i14" />
          {CANVAS_TEXT.autoLayout}
        </Button>
      </div>
      <div className="wfe-controls">
        <span>
          <FlowPlus />
        </span>
        <span>
          <FlowMinus />
        </span>
        <span>
          <Maximize />
        </span>
        <span>
          <MapIcon />
        </span>
        <span className="wfe-more-below" data-more-below="" hidden>
          <ChevronsDown />
        </span>
      </div>
    </div>
  );
}
