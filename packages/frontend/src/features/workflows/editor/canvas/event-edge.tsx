import { BaseEdge, type Edge, EdgeLabelRenderer, type EdgeProps, useStore } from "@xyflow/react";
import { CircleDashed, RotateCcw } from "lucide-react";
import { type ReactElement, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useEditor, useEditorState } from "../editor-context";
import type { EventEdgeData } from "../model/canvas-graph";
import { ProblemMarker } from "../panels/problem-marker";
import { KIND_ICON_CLASSES } from "../kind-styles";
import { roleIconsOf, senderLook } from "../sender-icon";
import {
  edgeTitle,
  entrySources,
  lineSelection,
  selectZoomShowsLabels,
  showsEdgeLabel,
} from "./edge-labels";
import { EdgeEndHandles, EndDragPreview, useEndDrag } from "./edge-end-handles";
import type { EdgeRoute } from "./edge-routes";
import type { CanvasEmphasis } from "./state-node";

export type EventEdgeType = Edge<
  EventEdgeData & {
    readonly emphasis: CanvasEmphasis;
    readonly route: EdgeRoute;
    /** The label text from `edgeLabelText`. The route keeps room for it. */
    readonly text: string;
    /** The selection is on the line. A hover shows the same emphasis, but no end handles. */
    readonly selected: boolean;
  },
  "event"
>;

const PATH_CLASSES = {
  selected: "workflow-edge-selected",
  related: "workflow-edge-related",
  dimmed: "workflow-edge-dimmed",
  normal: "",
} satisfies Record<CanvasEmphasis, string>;

const LABEL_CLASSES = {
  selected: "border-(--workflow-selection) ring-2 ring-(--workflow-selection-ring)",
  related: "border-(--workflow-selection-soft)",
  // The label fades with its line, but its text stays readable.
  dimmed: "opacity-60",
  normal: "",
} satisfies Record<CanvasEmphasis, string>;

type EventEdgeFullData = NonNullable<EventEdgeType["data"]>;

/** The one-line label of a line. A click selects its transition, or the next one of the line. */
function EdgeLabel({ data }: { data: EventEdgeFullData }): ReactElement {
  const { store, catalogRoles } = useEditor();
  const roleLabels = useMemo(
    () => new Map(catalogRoles.map(({ role }) => [role.id, role.label])),
    [catalogRoles],
  );
  const roleIcons = useMemo(() => roleIconsOf(catalogRoles), [catalogRoles]);
  const [first] = data.senders;
  // An approval line draws one button, so it reads as one transition.
  const single = data.eventIds.length === 1 || data.actionId !== null;
  const untriggered = single && !data.triggered;
  const { labelBox } = data.route;
  // The first trigger names who acts, so every triggered line shows one icon.
  const look = single && first && !untriggered ? senderLook(first, roleIcons) : null;
  // An entry names its source count in a muted tail that never cuts, after a name that can.
  const sources = entrySources(data);
  const name = sources === null ? data.text : data.text.slice(0, -` · ${sources}`.length);
  return (
    <EdgeLabelRenderer>
      <button
        type="button"
        className={cn(
          "nodrag nopan pointer-events-auto absolute flex items-center justify-center gap-1.5 rounded-full border border-border bg-card px-3 text-[13px] leading-none font-medium whitespace-nowrap text-card-foreground shadow-xs transition-[opacity,border-color] duration-150 ease-out hover:border-(--workflow-selection-soft) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          untriggered && "border-dashed font-normal text-muted-foreground",
          LABEL_CLASSES[data.emphasis],
        )}
        style={{
          width: labelBox.width,
          height: labelBox.height,
          // Whole pixels, so the border draws crisp and without colour fringes.
          transform: `translate(${Math.round(labelBox.x)}px, ${Math.round(labelBox.y)}px)`,
        }}
        data-event-ids={data.eventIds.join(" ")}
        title={edgeTitle(data, roleLabels)}
        aria-label={`${data.text}. Select transition.`}
        onMouseEnter={() => store.getState().hover(lineSelection(data, null))}
        onMouseLeave={() => store.getState().hover(null)}
        // The click reads the selection, so a selection change does not render every label.
        onClick={() => {
          const state = store.getState();
          state.select(lineSelection(data, state.selection?.key ?? null));
        }}
      >
        {untriggered ? <CircleDashed aria-hidden="true" className="size-3.5 shrink-0" /> : null}
        {data.resets ? (
          <RotateCcw aria-hidden="true" className="size-3.5 shrink-0 text-destructive-muted" />
        ) : null}
        {look && !data.resets ? (
          <look.Icon
            aria-hidden="true"
            className={cn("size-3.5 shrink-0", KIND_ICON_CLASSES[look.color])}
          />
        ) : null}
        <span className="min-w-0 truncate">{name}</span>
        {sources === null ? null : (
          <span className="shrink-0 font-normal text-muted-foreground">{sources}</span>
        )}
        <ProblemMarker level={data.problem} className="size-3.5" />
      </button>
    </EdgeLabelRenderer>
  );
}

/** The ends that a drag can move: those of the selected line of one transition. */
const movableEndsOf = (data: EventEdgeFullData, readOnly: boolean) =>
  !readOnly && data.eventIds.length === 1 && data.selected && data.kind === "arrow"
    ? data.route.ends
    : undefined;

/**
 * One line of the canvas: an arrow between two boxes, or a loop, with its label. A low zoom hides
 * the label, except on the line of the selected transition. The selected line offers its ends to
 * a drag onto another state.
 */
export function EventEdge({
  id,
  source,
  target,
  data,
  markerEnd,
}: EdgeProps<EventEdgeType>): ReactElement | null {
  const readOnly = useEditorState((state) => state.readOnly);
  const { drag, handlers } = useEndDrag({ eventId: data?.eventIds[0] ?? "", source, target });
  const zoomShowsLabels = useStore(selectZoomShowsLabels);
  if (!data) return null;
  const movableEnds = movableEndsOf(data, readOnly);
  return (
    <>
      <BaseEdge
        id={id}
        path={data.route.path}
        {...(markerEnd ? { markerEnd } : {})}
        interactionWidth={18}
        className={cn(
          PATH_CLASSES[data.emphasis],
          !data.triggered && "workflow-edge-untriggered",
          data.problem === "error" && "workflow-edge-error",
          drag && "workflow-edge-dragging",
        )}
      />
      {movableEnds && drag ? <EndDragPreview drag={drag} ends={movableEnds} /> : null}
      {movableEnds ? (
        <EdgeEndHandles
          ends={movableEnds}
          sourceMovable={data.sourceLabels.length === 0}
          drag={drag}
          handlers={handlers}
        />
      ) : null}
      {data.labelled && showsEdgeLabel(zoomShowsLabels, data.emphasis) ? (
        <EdgeLabel data={data} />
      ) : null}
    </>
  );
}
