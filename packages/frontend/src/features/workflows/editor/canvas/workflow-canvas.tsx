import "@xyflow/react/dist/style.css";
import "./workflow-canvas.css";
import { elementKey } from "@openducktor/workflows";
import {
  Background,
  type Connection,
  ControlButton,
  Controls,
  type EdgeMouseHandler,
  type EdgeTypes,
  MiniMap,
  type NodeChange,
  type NodeMouseHandler,
  type NodeTypes,
  type OnInit,
  type OnMove,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useStoreApi,
  type Viewport,
  type XYPosition,
} from "@xyflow/react";
import { LayoutGrid, Map as MapIcon, Maximize } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTheme } from "@/components/layout/theme-provider";
import { Button } from "@/components/ui/button";
import { useEditor, useEditorState } from "../editor-context";
import { deleteSelectionOnKey } from "../editor-keys";
import { autoLayout } from "../model/canvas-layout";
import { addEvent, addState } from "../model/create-elements";
import type { EditorStore } from "../model/editor-store";
import { NewElementButton } from "../panels/new-element-button";
import { type CanvasSize, MIN_SHOW_ALL_ZOOM, readableViewport } from "./canvas-viewport";
import type { Box } from "./canvas-geometry";
import { LABEL_MIN_ZOOM, lineSelection } from "./edge-labels";
import { EventEdge, type EventEdgeType } from "./event-edge";
import { StateNode, type StateNodeType } from "./state-node";
import { useRefitOnResize } from "./use-refit-on-resize";
import { useRevealSelection } from "./use-reveal-selection";
import { useViewportMover } from "./use-viewport-mover";
import { MoreBelowControl } from "./canvas-overlays";
import { GettingStarted } from "./getting-started";
import { useCanvasElements } from "./use-canvas-elements";
import { ConnectionLine } from "./connection-line";

const NODE_TYPES: NodeTypes = { state: StateNode };
const EDGE_TYPES: EdgeTypes = { event: EventEdge };
/** A focused state opens with Enter. React Flow selection stays off, so its own hint would mislead. */
const ARIA_LABELS = {
  "node.a11yDescription.default": "Press Enter to open the state.",
  "node.a11yDescription.keyboardDisabled": "Press Enter to open the state.",
  "edge.a11yDescription.default": "",
};

/** Enter or Space on a focused state box opens the state, as a click does. */
const openFocusedStateOnKey = (event: KeyboardEvent<HTMLDivElement>, store: EditorStore) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (!(event.target instanceof HTMLElement)) return;
  const id = event.target.closest<HTMLElement>(".react-flow__node")?.dataset.id;
  if (!id || event.target.closest("button, input, textarea")) return;
  event.preventDefault();
  store.getState().select(elementKey("state", id));
};

const PRO_OPTIONS = { hideAttribution: true };
const MINIMAP_STYLE = { width: 128, height: 84 };

function CanvasFlow({ size, toolbar }: { size: CanvasSize; toolbar: ReactNode }): ReactElement {
  const { store, sharedStates } = useEditor();
  const selectionKey = useEditorState((state) => state.selection?.key ?? null);
  const readOnly = useEditorState((state) => state.readOnly);
  const hasEvents = useEditorState((state) => state.document.definition.events.length > 0);
  const flowStore = useStoreApi();
  // The connection handles keep a grabbable size at any zoom. The zoom goes to a CSS variable, so
  // a zoom step re-renders no node.
  const flowRef = useRef<HTMLDivElement>(null);
  const showZoom = useCallback((viewport: Viewport) => {
    flowRef.current?.style.setProperty("--workflow-zoom", String(viewport.zoom));
  }, []);
  // React Flow sets a theme class on its root, so it must match the app theme.
  const { theme } = useTheme();
  // Box positions during a drag. The document takes them when the drag ends.
  const [dragging, setDragging] = useState<Readonly<Record<string, XYPosition>>>({});
  const draggingRef = useRef(dragging);
  const { nodes, edges, contentBox, contentBoxAt, selectionTarget } = useCanvasElements(dragging);
  // The opening viewport, computed once from the opening lines, so the first frame is final.
  const [openingViewport] = useState(() => readableViewport(contentBox, size));
  const mover = useViewportMover();
  useRevealSelection(flowRef, selectionKey, selectionTarget, mover);
  useRefitOnResize(flowRef, contentBox, mover);
  const [showMinimap, setShowMinimap] = useState(false);

  const fitTo = useCallback(
    (bounds: Box | null, minZoom?: number) => {
      const { width, height } = flowStore.getState();
      mover.move(readableViewport(bounds, { width, height }, minZoom), true);
    },
    [flowStore, mover],
  );

  const onNodesChange = useCallback((changes: NodeChange<StateNodeType>[]) => {
    const moved: Record<string, XYPosition> = {};
    for (const change of changes)
      if (change.type === "position" && change.dragging && change.position)
        moved[change.id] = change.position;
    if (Object.keys(moved).length === 0) return;
    draggingRef.current = { ...draggingRef.current, ...moved };
    setDragging(draggingRef.current);
  }, []);

  const onNodeDragStop = useCallback(() => {
    const moved = draggingRef.current;
    draggingRef.current = {};
    if (Object.keys(moved).length > 0) store.getState().setPositions(moved);
    setDragging({});
  }, [store]);

  // React Flow memoizes each box and line on its props, so the handlers keep their identity.
  const onNodeClick = useCallback<NodeMouseHandler<StateNodeType>>(
    (_, node) => store.getState().select(elementKey("state", node.id)),
    [store],
  );
  const onEdgeClick = useCallback<EdgeMouseHandler<EventEdgeType>>(
    (_, edge) => {
      const state = store.getState();
      if (edge.data) state.select(lineSelection(edge.data, state.selection?.key ?? null));
    },
    [store],
  );
  const onPaneClick = useCallback(() => store.getState().select(null), [store]);
  const onNodeMouseEnter = useCallback<NodeMouseHandler<StateNodeType>>(
    (_, node) => store.getState().hover(elementKey("state", node.id)),
    [store],
  );
  const onEdgeMouseEnter = useCallback<EdgeMouseHandler<EventEdgeType>>(
    (_, edge) => edge.data && store.getState().hover(lineSelection(edge.data, null)),
    [store],
  );
  const onLeave = useCallback(() => store.getState().hover(null), [store]);
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      openFocusedStateOnKey(event, store);
      deleteSelectionOnKey(event, store);
    },
    [store],
  );
  const onInit = useCallback<OnInit<StateNodeType, EventEdgeType>>(
    (instance) => showZoom(instance.getViewport()),
    [showZoom],
  );
  const onMove = useCallback<OnMove>((_, viewport) => showZoom(viewport), [showZoom]);

  const onConnect = useCallback(
    (connection: Connection) =>
      store
        .getState()
        .create((document) => addEvent(document, connection.source, connection.target)),
    [store],
  );

  return (
    <ReactFlow<StateNodeType, EventEdgeType>
      // A workflow without transitions shows the connection dots at rest, as a cue.
      className={hasEvents ? undefined : "workflow-canvas-empty"}
      ref={flowRef}
      onInit={onInit}
      onMove={onMove}
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      onNodesChange={onNodesChange}
      onNodeDragStop={onNodeDragStop}
      onConnect={onConnect}
      connectionLineComponent={ConnectionLine}
      onNodeClick={onNodeClick}
      onEdgeClick={onEdgeClick}
      onNodeMouseEnter={onNodeMouseEnter}
      onNodeMouseLeave={onLeave}
      onEdgeMouseEnter={onEdgeMouseEnter}
      onEdgeMouseLeave={onLeave}
      onPaneClick={onPaneClick}
      onKeyDown={onKeyDown}
      ariaLabelConfig={ARIA_LABELS}
      colorMode={theme}
      nodesConnectable={!readOnly}
      elementsSelectable={false}
      // The store owns every delete, so React Flow removes nothing itself.
      deleteKeyCode={null}
      // As in design tools: a drag on the background or a two-finger scroll pans, and a pinch or
      // Cmd (Ctrl) with the scroll wheel zooms.
      panOnDrag
      panOnScroll
      zoomOnScroll={false}
      zoomOnPinch
      minZoom={0.2}
      defaultViewport={openingViewport}
      proOptions={PRO_OPTIONS}
    >
      <Background gap={20} />
      <Controls showInteractive={false} showFitView={false}>
        <ControlButton
          onClick={() => fitTo(contentBox, MIN_SHOW_ALL_ZOOM)}
          title="Fit the workflow"
          aria-label="Fit the workflow"
        >
          <Maximize />
        </ControlButton>
        <ControlButton
          onClick={() => setShowMinimap(!showMinimap)}
          title={showMinimap ? "Hide the minimap" : "Show the minimap"}
          aria-label="Minimap"
          aria-pressed={showMinimap}
        >
          <MapIcon />
        </ControlButton>
        <MoreBelowControl content={contentBox} />
      </Controls>
      {/* The minimap shows on request, so it never covers a box by default. */}
      {showMinimap ? (
        <MiniMap
          pannable
          zoomable
          ariaLabel="Workflow minimap"
          style={MINIMAP_STYLE}
          nodeBorderRadius={6}
        />
      ) : null}
      <Panel position="top-left" className="!m-3 flex gap-2">
        {toolbar}
        {readOnly ? null : (
          <>
            <NewElementButton
              label="Add a state"
              placeholder="State name"
              onCreate={(name) =>
                store.getState().create((document) => addState(document, name, sharedStates))
              }
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5 bg-sidebar shadow-xs"
              onClick={() => {
                const laidOut = autoLayout(store.getState().document.definition);
                // Box positions last for this session only, so the workflow does not change.
                store.getState().setPositions(laidOut);
                // The new layout shows whole when its labels stay readable, else from its start.
                fitTo(contentBoxAt(laidOut), LABEL_MIN_ZOOM);
              }}
            >
              <LayoutGrid className="size-3.5" />
              Auto layout
            </Button>
          </>
        )}
      </Panel>
      {readOnly ? null : <GettingStarted />}
    </ReactFlow>
  );
}

/**
 * The states and transitions of the workflow as a node editor. Delete and Backspace delete the
 * selected state or transition. `toolbar` adds controls before the canvas commands.
 */
export function WorkflowCanvas({ toolbar }: { toolbar?: ReactNode }): ReactElement {
  // The opening viewport needs the canvas size, so the flow mounts after the first measure.
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<CanvasSize | null>(null);
  // The resizable panel group sizes the canvas after its first layout, so the size comes from the
  // first observation with an area.
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (!box || box.width === 0 || box.height === 0) return;
      setSize({ width: box.width, height: box.height });
      observer.disconnect();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={containerRef} className="workflow-canvas h-full w-full">
      {size ? (
        <ReactFlowProvider>
          <CanvasFlow size={size} toolbar={toolbar} />
        </ReactFlowProvider>
      ) : null}
    </div>
  );
}
