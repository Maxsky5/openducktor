import { TASK_CLOSED_STATE, TASK_OPEN_STATE, type WorkflowTone } from "@openducktor/contracts";
import { Handle, type Node, type NodeProps, Position, useConnection } from "@xyflow/react";
import { CircleCheckBig, Columns3, Inbox, Link2, Lock, type LucideIcon } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import type { StateNodeData } from "../model/canvas-graph";
import { ProblemMarker } from "../panels/problem-marker";

/** A box starts a new arrow from a dot on any side. The canvas picks the drawn sides itself. */
const SOURCE_SIDES = [
  ["top", Position.Top],
  ["right", Position.Right],
  ["bottom", Position.Bottom],
  ["left", Position.Left],
] as const;

/** How a box shows against the current selection. */
export type CanvasEmphasis = "selected" | "related" | "dimmed" | "normal";

export type StateNodeType = Node<
  StateNodeData & { readonly emphasis: CanvasEmphasis; readonly connectable: boolean },
  "state"
>;

/**
 * The boxes that the hovered or selected element links stand out, and the others fade, but stay
 * readable.
 */
const EMPHASIS_CLASSES = {
  selected:
    "border-(--workflow-selection) ring-4 ring-(--workflow-selection-ring) hover:border-(--workflow-selection)",
  related: "border-(--workflow-selection-soft) ring-2 ring-(--workflow-selection-ring)",
  dimmed: "opacity-60",
  normal: "",
} satisfies Record<CanvasEmphasis, string>;

/** The icon tile of a tone: a soft tint of the tone colour behind an icon in that colour. */
const TONE_TILE_CLASSES = {
  neutral: "bg-muted text-muted-foreground",
  pending: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  info: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  warning: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  destructive: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  review: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300",
  approval: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300",
  success: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
} satisfies Record<WorkflowTone, string>;

/** The first column takes new tasks, the last one closes them, the others hold work. */
const stateIcon = (stateId: string): LucideIcon => {
  if (stateId === TASK_OPEN_STATE) return Inbox;
  if (stateId === TASK_CLOSED_STATE) return CircleCheckBig;
  return Columns3;
};

/**
 * Details for experienced users: they show in the corner on hover, so a new board stays calm and
 * the name keeps its full width.
 */
const MARKER_CLASS =
  "absolute top-1.5 right-2 flex items-center text-muted-foreground opacity-0 transition-opacity group-hover/state:opacity-100";

/** The marker of a state that every workflow has, or that another workflow shares. */
function StateMarker({ core, shared }: { core: boolean; shared: boolean }): ReactElement | null {
  if (core)
    return (
      <span
        title="Every workflow has this state. You can rename it but not delete it."
        className={MARKER_CLASS}
      >
        <Lock aria-label="Core state" className="size-3" />
      </span>
    );
  if (shared)
    return (
      <span
        title="A published workflow uses this state ID too, so the board shows both in one column. Drafts do not count until they are published."
        className={MARKER_CLASS}
      >
        <Link2 aria-label="Shared state" className="size-3" />
      </span>
    );
  return null;
}

/** A state box: tone, label, ID, problem marker, and the core or shared marker. */
export function StateNode({ data }: NodeProps<StateNodeType>): ReactElement {
  const connecting = useConnection((connection) => connection.inProgress);
  const StateIcon = stateIcon(data.stateId);
  return (
    <div
      className={cn(
        "workflow-state-box group/state relative flex h-[68px] w-[240px] items-center gap-3 rounded-xl border border-border bg-card px-3 text-card-foreground shadow-sm transition-[opacity,box-shadow,border-color] duration-150 ease-out hover:border-foreground/20 hover:shadow-md",
        EMPHASIS_CLASSES[data.emphasis],
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg",
          TONE_TILE_CLASSES[data.tone],
        )}
      >
        <StateIcon className="size-5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="min-w-0 flex-1 truncate text-[15px] leading-5 font-semibold"
            title={`${data.label} (${data.stateId})`}
          >
            {data.label}
          </span>
          <ProblemMarker level={data.problem} title={data.problemText ?? undefined} />
          <StateMarker core={data.core} shared={data.shared} />
        </div>
      </div>
      {SOURCE_SIDES.map(([side, position]) => (
        <Handle
          key={side}
          id={side}
          type="source"
          position={position}
          isConnectable={data.connectable}
          className="workflow-state-source"
          title={data.connectable ? "Drag onto another state to add a transition" : undefined}
          aria-label={`Drag to another state to add a transition from ${data.label}`}
        />
      ))}
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={data.connectable}
        isConnectableStart={false}
        className={cn("workflow-state-target", connecting && "is-connecting")}
      />
    </div>
  );
}
