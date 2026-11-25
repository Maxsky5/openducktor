import { elementKey } from "@openducktor/workflows";
import { MarkerType, type XYPosition } from "@xyflow/react";
import { useCallback, useMemo, useState } from "react";
import { useEditor, useEditorState, useEditorView } from "../editor-context";
import {
  type CanvasEdge,
  type CanvasHighlight,
  type CanvasLink,
  canvasHighlight,
  foldedLinks,
} from "../model/canvas-graph";
import { elementExists } from "../model/document-elements";
import { STATE_BOX_HEIGHT, STATE_BOX_WIDTH } from "../model/canvas-layout";
import { contentBounds } from "./canvas-viewport";
import type { Box } from "./canvas-geometry";
import { edgeLabelText } from "./edge-labels";
import { type EdgeRoute, type RoutedLink, routeLinks } from "./edge-routes";
import type { EventEdgeType } from "./event-edge";
import { createItemKeeper, createValueKeeper } from "./kept-values";
import { revealTarget } from "./reveal-target";
import type { CanvasEmphasis, StateNodeType } from "./state-node";

/** An arrowhead of about 8px at any line width. */
const marker = (color: string) => ({
  type: MarkerType.ArrowClosed,
  width: 30,
  height: 30,
  markerUnits: "userSpaceOnUse",
  color,
});
const MARKERS = {
  normal: marker("var(--workflow-edge-stroke)"),
  emphasized: marker("var(--workflow-selection)"),
};

const NO_ROUTES: ReadonlyMap<string, EdgeRoute> = new Map();

/** The box of each state at its position. */
const boxesAt = (positions: Readonly<Record<string, XYPosition>>): Map<string, Box> =>
  new Map(
    Object.entries(positions).map(([id, position]): [string, Box] => [
      id,
      { ...position, width: STATE_BOX_WIDTH, height: STATE_BOX_HEIGHT },
    ]),
  );

/** The box around the boxes and the lines with their labels. */
const routedContent = (
  boxes: ReadonlyMap<string, Box>,
  routes: ReadonlyMap<string, EdgeRoute>,
): Box | null =>
  contentBounds([...boxes.values(), ...[...routes.values()].map(({ extent }) => extent)]);

/** The keys of the transitions and the button that a line draws. */
const lineKeys = (data: CanvasEdge["data"]) => [
  ...data.eventIds.map((eventId) => elementKey("event", eventId)),
  ...(data.actionId === null ? [] : [elementKey("action", data.actionId)]),
];

/**
 * The lines of the arrows that the entry of the selection folds. They take the look of the
 * entry, without its label, and they show the selection.
 */
const foldedEdges = (
  folded: readonly CanvasLink[],
  entry: CanvasEdge | undefined,
  routes: ReadonlyMap<string, EdgeRoute>,
  text: string,
): EventEdgeType[] =>
  entry === undefined
    ? []
    : folded.flatMap((link): EventEdgeType[] => {
        const route = routes.get(link.id);
        if (!route) return [];
        return [
          {
            id: link.id,
            source: link.source,
            target: link.target,
            type: "event",
            markerEnd: MARKERS.emphasized,
            ariaLabel: `Transition line: ${text}`,
            focusable: false,
            data: {
              ...entry.data,
              kind: "arrow",
              labelled: false,
              emphasis: "selected",
              route,
              text,
              // The entry keeps the end handles, so these lines offer none.
              selected: false,
            },
          },
        ];
      });

const emphasisOf = (
  highlight: CanvasHighlight,
  related: boolean,
  selected: boolean,
): CanvasEmphasis => {
  if (selected) return "selected";
  if (!highlight.active) return "normal";
  return related ? "related" : "dimmed";
};

/**
 * The boxes and lines of the canvas, from the derived graph, the saved and dragged positions, and
 * the hovered or selected element. Unchanged boxes and lines keep their objects, so React Flow renders only what an
 * edit, a drag, or a selection changes.
 */
export const useCanvasElements = (dragging: Readonly<Record<string, XYPosition>>) => {
  const { catalogRoles } = useEditor();
  const index = useEditorView((view) => view.index);
  const graph = useEditorView((view) => view.graph);
  const layoutStates = useEditorState((state) => state.document.layout.states);
  const viewPositions = useEditorState((state) => state.viewPositions);
  const selectionKey = useEditorState((state) => state.selection?.key ?? null);
  // A row or box can go while the pointer is on it, such as after a delete, and leaves no leave
  // event. The hover then counts only while its element exists.
  const hoverKey = useEditorState(({ hoverKey: key, document }) =>
    key !== null && elementExists(document, key) ? key : null,
  );
  const readOnly = useEditorState((state) => state.readOnly);
  const definition = useEditorState((state) => state.document.definition);
  const [keepers] = useState(() => ({
    positions: createValueKeeper<Readonly<Record<string, XYPosition>>>(),
    links: createValueKeeper<readonly RoutedLink[]>(),
    nodes: createItemKeeper<StateNodeType>(),
    edges: createItemKeeper<EventEdgeType>(),
  }));

  // A hover previews what an element links. Without one, the selection decides.
  const focusKey = hoverKey ?? selectionKey;
  const highlight = useMemo(() => canvasHighlight(index, focusKey), [index, focusKey]);
  // The positions change only when a box moves, so a keystroke or a selection routes no line.
  const positions = useMemo(() => {
    // The positions of this session go over the saved layout.
    const placed = { ...layoutStates, ...viewPositions };
    const lowest = Math.max(0, ...Object.values(placed).map(({ y }) => y));
    let unplaced = 0;
    const next: Record<string, XYPosition> = {};
    for (const { id } of graph.nodes)
      next[id] = dragging[id] ??
        placed[id] ?? { x: 0, y: lowest + (STATE_BOX_HEIGHT + 80) * ++unplaced };
    return keepers.positions(next);
  }, [keepers, graph.nodes, layoutStates, viewPositions, dragging]);
  const nodes = useMemo(
    () =>
      keepers.nodes(
        graph.nodes.map((node): StateNodeType => {
          const key = elementKey("state", node.id);
          return {
            id: node.id,
            type: "state",
            position: positions[node.id]!,
            width: STATE_BOX_WIDTH,
            height: STATE_BOX_HEIGHT,
            // The boxes have a fixed size. React Flow rebuilds its node from this object on each
            // change, so the measured size must come with it, or a drag reads an unmeasured node.
            measured: { width: STATE_BOX_WIDTH, height: STATE_BOX_HEIGHT },
            draggable: !readOnly,
            ariaLabel: `${node.data.label} state`,
            data: {
              ...node.data,
              connectable: !readOnly,
              emphasis: emphasisOf(highlight, highlight.states.has(node.id), selectionKey === key),
            },
          };
        }),
      ),
    [keepers, graph.nodes, positions, highlight, selectionKey, readOnly],
  );
  const boxes = useMemo(() => boxesAt(positions), [positions]);
  const texts = useMemo(() => {
    const roleLabels = new Map(catalogRoles.map(({ role }) => [role.id, role.label]));
    return new Map(graph.edges.map(({ id, data }) => [id, edgeLabelText(data, roleLabels)]));
  }, [graph.edges, catalogRoles]);
  const links = useMemo(
    () =>
      keepers.links(
        graph.edges.map(({ id, source, target, data }) => ({
          id,
          kind: data.kind,
          source,
          target,
          text: texts.get(id)!,
          labelled: data.labelled,
          marked: data.problem !== null,
        })),
      ),
    [keepers, graph.edges, texts],
  );
  const routes = useMemo(() => routeLinks(links, boxes), [links, boxes]);
  // The selection unfolds its entry into one arrow from each source. The other lines keep the
  // routes above, so a selection moves no line.
  const folded = useMemo(() => foldedLinks(definition, selectionKey), [definition, selectionKey]);
  const foldedRoutes = useMemo(() => {
    if (folded.length === 0) return NO_ROUTES;
    const extra = folded.map(({ id, source, target }): RoutedLink => ({
      id,
      kind: "arrow",
      source,
      target,
      text: "",
      labelled: false,
    }));
    return routeLinks([...links, ...extra], boxes);
  }, [folded, links, boxes]);
  const contentBox = useMemo(() => routedContent(boxes, routes), [boxes, routes]);
  /** The content box at other positions, such as those of Auto layout before they render. */
  const contentBoxAt = useCallback(
    (placed: Readonly<Record<string, XYPosition>>) => {
      const placedBoxes = boxesAt(placed);
      return routedContent(placedBoxes, routeLinks(links, placedBoxes));
    },
    [links],
  );

  const edges = useMemo(
    () =>
      keepers.edges(
        graph.edges.flatMap((edge): EventEdgeType[] => {
          const route = routes.get(edge.id);
          if (!route) return [];
          const keys = lineKeys(edge.data);
          const emphasis = emphasisOf(
            highlight,
            edge.data.eventIds.some((eventId) => highlight.events.has(eventId)),
            // The hovered line stands out as the selected one does.
            keys.some((key) => key === selectionKey || key === hoverKey),
          );
          const emphasized = emphasis === "selected" || emphasis === "related";
          const text = texts.get(edge.id)!;
          return [
            {
              id: edge.id,
              source: edge.source,
              target: edge.target,
              type: "event",
              markerEnd: emphasized ? MARKERS.emphasized : MARKERS.normal,
              ariaLabel: `Transition line: ${text}`,
              // The label button is the keyboard target of a line.
              focusable: false,
              data: {
                ...edge.data,
                emphasis,
                route,
                text,
                selected: selectionKey !== null && keys.includes(selectionKey),
              },
            },
          ];
        }),
      ),
    [keepers, graph.edges, routes, texts, highlight, selectionKey, hoverKey],
  );
  const allEdges = useMemo(() => {
    if (folded.length === 0) return edges;
    const entry = graph.edges.find(
      ({ data }) => data.kind === "entry" && lineKeys(data).some((key) => key === selectionKey),
    );
    const text = entry ? texts.get(entry.id)! : "";
    return [...edges, ...foldedEdges(folded, entry, foldedRoutes, text)];
  }, [edges, folded, graph.edges, selectionKey, texts, foldedRoutes]);

  const selectionTarget = useMemo(
    () =>
      revealTarget(
        selectionKey,
        boxes,
        graph.edges,
        routes,
        folded.flatMap(({ id }) => foldedRoutes.get(id)?.extent ?? []),
      ),
    [selectionKey, boxes, graph.edges, routes, folded, foldedRoutes],
  );
  return { graph, nodes, edges: allEdges, boxes, contentBox, contentBoxAt, selectionTarget };
};
