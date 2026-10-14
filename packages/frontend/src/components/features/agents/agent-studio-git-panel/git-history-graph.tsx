import type { GitHistoryCommitMembership } from "@openducktor/contracts";
import { type ReactElement, useCallback, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { AuthorAvatar } from "./git-history-avatar";
import type { GraphEdge, GraphRow } from "./git-history-graph-model";

export const ROW_HEIGHT = 32;
/** The bar in the lane color that ends the graph column. */
export const GRAPH_ACCENT_WIDTH = 3;
const LANE_WIDTH = 22;
const GRAPH_PADDING = 6;
const AVATAR_RADIUS = 10;
const MERGE_RADIUS = 4.5;
const BASE_RADIUS = 5;
/** The corner radius where a line turns into another lane. */
const TURN_RADIUS = 7;
/** The graph takes at most this part of a row, so the commit text stays readable. */
const GRAPH_SHARE = 0.4;
const MIN_GRAPH_VIEW_WIDTH = GRAPH_PADDING * 2 + LANE_WIDTH * 2;
/** A narrow graph still gets this width, so each row band has room, as in GitKraken. */
const MIN_COLUMN_WIDTH = 84;
/** The band of a row starts at the left edge of its avatar. */
const BAND_INSET = AVATAR_RADIUS + 3;

/**
 * Lane colors of each side. Branch commits use cool colors and missing target commits use warm
 * colors, so every lane keeps its side when the graph has many lanes.
 */
const LANE_COLORS = {
  current: [
    "text-blue-500",
    "text-violet-500",
    "text-pink-500",
    "text-teal-500",
    "text-indigo-500",
  ],
  target: ["text-amber-500", "text-orange-500", "text-rose-500"],
  boundary: ["text-slate-400 dark:text-slate-500"],
} satisfies Record<GitHistoryCommitMembership, string[]>;

/** The text color of a lane. Lines, nodes, and bands use it through `currentColor`. */
export const laneColor = (tone: GitHistoryCommitMembership, lane: number): string => {
  const colors = LANE_COLORS[tone];
  return colors[lane % colors.length] ?? colors[0] ?? "";
};

/** The visible part of the graph. Rows show the same part, so lanes stay aligned. */
export type GraphView = {
  width: number;
  viewWidth: number;
  scrollBy: (delta: number) => void;
};

/**
 * The sideways scroll of the graph, in pixels. The History root sets it on each scroll, so rows
 * follow the scroll in CSS and do not render again.
 */
export const GRAPH_OFFSET_PROPERTY = "--history-graph-offset";

/**
 * A graph wider than its share of the row scrolls sideways. Every row moves together, so the
 * lanes keep their edges, and the commit text keeps its space.
 */
export function useGraphView(laneCount: number, rowWidth: number) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const width = GRAPH_PADDING * 2 + laneCount * LANE_WIDTH;
  const columnWidth = Math.max(width, MIN_COLUMN_WIDTH);
  // Before the first measure, the graph keeps its full width.
  const viewWidth =
    rowWidth > 0
      ? Math.min(columnWidth, Math.max(MIN_GRAPH_VIEW_WIDTH, Math.floor(rowWidth * GRAPH_SHARE)))
      : columnWidth;
  const scrollBy = useCallback((delta: number) => scroller.current?.scrollBy({ left: delta }), []);
  // A stable view keeps the rows of the list from rendering again for an unrelated change.
  const graph = useMemo<GraphView>(
    () => ({ width, viewWidth, scrollBy }),
    [scrollBy, viewWidth, width],
  );
  return { graph, scroller };
}

export const laneX = (lane: number) => GRAPH_PADDING + lane * LANE_WIDTH + LANE_WIDTH / 2;

/**
 * The graph part of a row. A band in the lane color runs from the commit node to the text, and a
 * bar in the same color starts the text, as in GitKraken.
 */
export function HistoryGraphCell({
  row,
  graph,
  connectFromLeft = false,
}: {
  row: GraphRow;
  graph: GraphView;
  /** True when the Branch / Tag column on the left labels this commit. */
  connectFromLeft?: boolean;
}): ReactElement {
  const clipped = graph.viewWidth < graph.width;
  const color = laneColor(row.commit.membership, row.lane);
  const nodeX = laneX(row.lane);
  // A graph that fits has no sideways scroll, so an old offset does not apply.
  const offset = clipped ? `var(${GRAPH_OFFSET_PROPERTY}, 0px)` : "0px";
  return (
    <>
      <span
        className="relative block h-full shrink-0 overflow-hidden"
        style={{ width: graph.viewWidth }}
        onWheel={(event) => {
          // A sideways swipe over the graph moves every row's lanes together.
          if (clipped && event.deltaX !== 0) graph.scrollBy(event.deltaX);
        }}
      >
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-y-[3px] right-0 rounded-l-full bg-current opacity-15 transition-opacity dark:opacity-20",
            "group-hover/history-row:opacity-25 group-data-[state=open]/history-row:opacity-35 dark:group-hover/history-row:opacity-30",
            color,
          )}
          style={{ left: `max(0px, calc(${nodeX - BAND_INSET}px - ${offset}))` }}
        />
        {connectFromLeft ? (
          // A line from the Branch / Tag column to the node ties the label to its commit.
          <span
            aria-hidden="true"
            className={cn("absolute top-1/2 left-0 h-0.5 -translate-y-1/2 bg-current", color)}
            style={{ width: `max(0px, calc(${nodeX - AVATAR_RADIUS}px - ${offset}))` }}
          />
        ) : null}
        <span
          className="absolute inset-y-0 left-0"
          style={{ width: graph.width, transform: `translateX(calc(-1 * ${offset}))` }}
          data-testid="agent-studio-git-history-graph-lanes"
        >
          <HistoryGraph row={row} width={graph.width} />
          {showsAuthor(row) ? <NodeAvatar row={row} left={nodeX} /> : null}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={cn("h-[calc(100%-6px)] shrink-0 bg-current", color)}
        style={{ width: GRAPH_ACCENT_WIDTH }}
      />
    </>
  );
}

/** A line that leaves the node row into another lane: across, then a round turn, then down. */
const turnDown = (x: number, to: number, middle: number): string => {
  const radius = Math.min(TURN_RADIUS, Math.abs(to - x), ROW_HEIGHT - middle);
  const direction = Math.sign(to - x);
  return `M ${x} ${middle} H ${to - direction * radius} Q ${to} ${middle} ${to} ${middle + radius} V ${ROW_HEIGHT}`;
};

/** A line that comes from another lane into the node: down, then a round turn, then across. */
const turnIn = (from: number, x: number, middle: number): string => {
  const radius = Math.min(TURN_RADIUS, Math.abs(from - x), middle);
  const direction = Math.sign(x - from);
  return `M ${from} 0 V ${middle - radius} Q ${from} ${middle} ${from + direction * radius} ${middle} H ${x}`;
};

function HistoryGraph({ row, width }: { row: GraphRow; width: number }): ReactElement {
  const middle = ROW_HEIGHT / 2;
  const x = laneX(row.lane);
  const edge = (key: string, entry: GraphEdge, path: string, dashed = false) => (
    <path
      key={key}
      d={path}
      className={laneColor(entry.tone, entry.lane)}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeDasharray={dashed ? "0.5 4" : undefined}
      fill="none"
    />
  );
  return (
    <svg
      width={width}
      height={ROW_HEIGHT}
      viewBox={`0 0 ${width} ${ROW_HEIGHT}`}
      className="block overflow-visible"
      aria-hidden="true"
      data-testid="agent-studio-git-history-graph"
    >
      {row.passThrough.map((entry) =>
        edge(`pass-${entry.lane}`, entry, `M ${laneX(entry.lane)} 0 V ${ROW_HEIGHT}`),
      )}
      {row.incoming.map((entry) =>
        edge(
          `in-${entry.lane}`,
          entry,
          entry.lane === row.lane ? `M ${x} 0 V ${middle}` : turnIn(laneX(entry.lane), x, middle),
        ),
      )}
      {row.outgoing.map((entry) =>
        edge(
          `out-${entry.lane}`,
          entry,
          entry.lane === row.lane
            ? `M ${x} ${middle} V ${ROW_HEIGHT}`
            : turnDown(x, laneX(entry.lane), middle),
        ),
      )}
      {row.reachesLimit ? (
        <g data-testid="agent-studio-git-history-limit">
          {edge(
            "limit",
            { lane: row.lane, tone: row.commit.membership },
            `M ${x} ${middle} V ${ROW_HEIGHT}`,
            true,
          )}
          <title>Older shared history is outside this comparison.</title>
        </g>
      ) : null}
      <CommitNode x={x} y={middle} row={row} />
    </svg>
  );
}

function CommitNode({ x, y, row }: { x: number; y: number; row: GraphRow }): ReactElement {
  const { commit } = row;
  const color = laneColor(commit.membership, row.lane);
  if (commit.membership === "boundary") {
    // The shared base ends the comparison, so it has an open marker.
    return (
      <circle
        cx={x}
        cy={y}
        r={BASE_RADIUS}
        className={cn(color, "fill-card")}
        stroke="currentColor"
        strokeWidth={2.5}
      />
    );
  }
  if (commit.parentOids.length > 1) {
    return (
      <circle
        cx={x}
        cy={y}
        r={MERGE_RADIUS}
        className={cn(color, "stroke-card")}
        fill="currentColor"
        strokeWidth={1.5}
      />
    );
  }
  // The author photo lies over this ring, so the ring keeps the lane color around it.
  return (
    <g className={color}>
      <circle cx={x} cy={y} r={AVATAR_RADIUS + 1.5} className="fill-card" />
      <circle cx={x} cy={y} r={AVATAR_RADIUS} fill="currentColor" />
    </g>
  );
}

/** True for a commit whose node shows the author, not a merge dot or the base marker. */
const showsAuthor = (row: GraphRow): boolean =>
  row.commit.membership !== "boundary" && row.commit.parentOids.length <= 1;

/**
 * The author photo of a commit node. HTML lies over the SVG ring, so a photo that does not load
 * falls back to the initials. Missing target commits show their photo faded and their initials
 * open, so their side does not depend on color alone.
 */
function NodeAvatar({ row, left }: { row: GraphRow; left: number }): ReactElement {
  const isTarget = row.commit.membership === "target";
  return (
    <AuthorAvatar
      name={row.commit.authorName}
      email={row.commit.authorEmail}
      className={cn(
        "pointer-events-none absolute top-1/2 size-[18px] -translate-y-1/2",
        isTarget ? "bg-card opacity-75 grayscale-[35%]" : "bg-transparent",
      )}
      initialsClassName={cn("text-[8px]", isTarget ? "text-current" : "text-white")}
      style={{ left: left - AVATAR_RADIUS + 1 }}
    />
  );
}
