import type { GitHistoryCommit, GitHistoryCommitMembership } from "@openducktor/contracts";

/**
 * One lane line in a row. Its tone follows the side of the commit that opened the lane, and its
 * color follows the line of commits, so a new commit above it does not change either.
 */
export type GraphEdge = { lane: number; tone: GitHistoryCommitMembership; color: number };

export type GraphRow = {
  commit: GitHistoryCommit;
  lane: number;
  /** The color of the line that the commit sits on. */
  color: number;
  /** Lanes that cross the row without touching its commit. */
  passThrough: GraphEdge[];
  /** Lanes from the rows above that end at this commit. */
  incoming: GraphEdge[];
  /** Lanes from this commit to its parents in the rows below. */
  outgoing: GraphEdge[];
  /** True when a parent is older than the shared boundary, so its edge stops at the limit. */
  reachesLimit: boolean;
};

export type GraphLayout = { rows: GraphRow[]; laneCount: number };

type OpenLane = { oid: string; tone: GitHistoryCommitMembership; color: number };

/** The color of a branch tip line: the main color of its side. */
const MAIN_LINE_COLOR = 0;

/**
 * A merged line takes its color from the ID of its first commit. The ID never changes, so the line
 * keeps its color when new commits move the lanes.
 */
const mergedLineColor = (oid: string): number => {
  let hash = 0;
  for (const char of oid.slice(0, 8)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return 1 + hash;
};

const firstFreeLane = (lanes: (OpenLane | null)[]): number => {
  const free = lanes.indexOf(null);
  return free === -1 ? lanes.length : free;
};

/**
 * Where a branch tip, a commit without a child row, starts its lane.
 * - `dedicated`: a new lane right of every lane above it, so a branch never continues the column
 *   of commits that another branch merged. A comparison of two branches uses it.
 * - `firstFree`: the first free lane, so a graph of many branches stays narrow.
 */
export type TipLane = "dedicated" | "firstFree";

/**
 * Places each commit in a lane. Rows come children first, so a lane waits for the next parent.
 * The layout of a row depends only on the rows above it, so later pages keep earlier lanes.
 */
export function layoutHistoryGraph(
  commits: readonly GitHistoryCommit[],
  { tipLane }: { tipLane: TipLane },
): GraphLayout {
  const membershipByOid = new Map(commits.map((commit) => [commit.oid, commit.membership]));
  const lanes: (OpenLane | null)[] = [];
  const rows: GraphRow[] = [];
  let laneCount = 0;
  for (const commit of commits) {
    const passThrough: GraphEdge[] = [];
    const incoming: GraphEdge[] = [];
    lanes.forEach((open, index) => {
      if (!open) return;
      const edges = open.oid === commit.oid ? incoming : passThrough;
      edges.push({ lane: index, tone: open.tone, color: open.color });
    });
    const lane = incoming[0]?.lane ?? (tipLane === "dedicated" ? laneCount : firstFreeLane(lanes));
    const color = incoming[0]?.color ?? MAIN_LINE_COLOR;
    // Lanes between the open lanes and a dedicated tip lane stay free for later merges.
    while (lanes.length < lane) lanes.push(null);
    for (const edge of incoming) lanes[edge.lane] = null;

    const outside = new Set(commit.outsideParentOids);
    const outgoing: GraphEdge[] = [];
    commit.parentOids
      .filter((parent) => !outside.has(parent))
      .forEach((parent, index) => {
        const existing = lanes.findIndex((open) => open?.oid === parent);
        // A line joins a lane on its left that waits for the same parent. A first parent does not
        // move right into a newer branch, so a left lane keeps its branch down to the parent.
        const keepsLane = index === 0 && existing > lane && lanes[lane] == null;
        if (existing !== -1 && !keepsLane) {
          const open = lanes[existing];
          outgoing.push({
            lane: existing,
            tone: open?.tone ?? commit.membership,
            color: open?.color ?? color,
          });
          return;
        }
        // The first parent continues the line. Another parent starts a merged line.
        const line: OpenLane =
          index === 0
            ? { oid: parent, tone: commit.membership, color }
            : {
                oid: parent,
                tone: membershipByOid.get(parent) ?? commit.membership,
                color: mergedLineColor(parent),
              };
        const target = index === 0 && lanes[lane] == null ? lane : firstFreeLane(lanes);
        lanes[target] = line;
        outgoing.push({ lane: target, tone: line.tone, color: line.color });
      });
    while (lanes.length > 0 && lanes.at(-1) == null) lanes.pop();

    const edgeLanes = [...passThrough, ...incoming, ...outgoing].map((entry) => entry.lane);
    laneCount = Math.max(laneCount, lane + 1, ...edgeLanes.map((used) => used + 1));
    rows.push({
      commit,
      lane,
      color,
      passThrough,
      incoming,
      outgoing,
      reachesLimit: outside.size > 0,
    });
  }
  return { rows, laneCount: Math.max(laneCount, 1) };
}

const relativeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** For example `3 hours ago`. */
export function formatRelativeCommitDate(authorDate: string, nowMs: number): string {
  const seconds = Math.round((Date.parse(authorDate) - nowMs) / 1000);
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  }
  return relativeFormat.format(0, "minute");
}

const EXACT_DATE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(Z|[+-]\d{2}:\d{2})$/u;
const WHITESPACE = /\s+/u;

/** Keeps the author's own clock time and offset, for example `2026-10-13 14:05:22 +02:00`. */
export function formatExactCommitDate(authorDate: string): string {
  const match = EXACT_DATE.exec(authorDate);
  if (!match) return authorDate;
  const offset = match[3] === "Z" ? "+00:00" : match[3];
  return `${match[1]} ${match[2]} ${offset}`;
}

const COMPACT_UNITS: [string, number][] = [
  ["y", 365 * 24 * 3600],
  ["mo", 30 * 24 * 3600],
  ["w", 7 * 24 * 3600],
  ["d", 24 * 3600],
  ["h", 3600],
  ["m", 60],
];

/** A short age for a narrow column, for example `3h` or `2mo`. */
export function formatCompactCommitAge(authorDate: string, nowMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - Date.parse(authorDate)) / 1000));
  for (const [unit, size] of COMPACT_UNITS) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${unit}`;
  }
  return "now";
}

/** Up to two initials of an author, for example `MR` for Maxime Ribera. */
export function authorInitials(authorName: string): string {
  const words = authorName.trim().split(WHITESPACE).filter(Boolean);
  const first = words[0] ?? "";
  const last = words.length > 1 ? (words.at(-1) ?? "") : "";
  return (last ? `${first.charAt(0)}${last.charAt(0)}` : first.slice(0, 2)).toUpperCase();
}
