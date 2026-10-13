import type { GitHistoryCommit, GitHistoryCommitMembership } from "@openducktor/contracts";

/** One lane line in a row. Its tone follows the side of the commit that opened the lane. */
export type GraphEdge = { lane: number; tone: GitHistoryCommitMembership };

export type GraphRow = {
  commit: GitHistoryCommit;
  lane: number;
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

type OpenLane = { oid: string; tone: GitHistoryCommitMembership };

const firstFreeLane = (lanes: (OpenLane | null)[]): number => {
  const free = lanes.indexOf(null);
  return free === -1 ? lanes.length : free;
};

/**
 * Places each commit in a lane. Rows come children first, so a lane waits for the next parent.
 * The layout of a row depends only on the rows above it, so later pages keep earlier lanes.
 */
export function layoutHistoryGraph(commits: readonly GitHistoryCommit[]): GraphLayout {
  const membershipByOid = new Map(commits.map((commit) => [commit.oid, commit.membership]));
  const lanes: (OpenLane | null)[] = [];
  const rows: GraphRow[] = [];
  let laneCount = 1;
  for (const commit of commits) {
    const passThrough: GraphEdge[] = [];
    const incoming: GraphEdge[] = [];
    lanes.forEach((open, index) => {
      if (!open) return;
      const edges = open.oid === commit.oid ? incoming : passThrough;
      edges.push({ lane: index, tone: open.tone });
    });
    const lane = incoming[0]?.lane ?? firstFreeLane(lanes);
    for (const edge of incoming) lanes[edge.lane] = null;

    const outside = new Set(commit.outsideParentOids);
    const outgoing: GraphEdge[] = [];
    commit.parentOids
      .filter((parent) => !outside.has(parent))
      .forEach((parent, index) => {
        const existing = lanes.findIndex((open) => open?.oid === parent);
        if (existing !== -1) {
          outgoing.push({ lane: existing, tone: lanes[existing]?.tone ?? commit.membership });
          return;
        }
        const target = index === 0 && lanes[lane] == null ? lane : firstFreeLane(lanes);
        const tone =
          index === 0 ? commit.membership : (membershipByOid.get(parent) ?? commit.membership);
        lanes[target] = { oid: parent, tone };
        outgoing.push({ lane: target, tone });
      });
    while (lanes.length > 0 && lanes.at(-1) == null) lanes.pop();

    const edgeLanes = [...passThrough, ...incoming, ...outgoing].map((entry) => entry.lane);
    laneCount = Math.max(laneCount, lane + 1, ...edgeLanes.map((used) => used + 1));
    rows.push({
      commit,
      lane,
      passThrough,
      incoming,
      outgoing,
      reachesLimit: outside.size > 0,
    });
  }
  return { rows, laneCount };
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

/** Keeps the author's own clock time and offset, for example `2026-10-13 14:05:22 +02:00`. */
export function formatExactCommitDate(authorDate: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(Z|[+-]\d{2}:\d{2})$/u.exec(authorDate);
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
  const words = authorName.trim().split(/\s+/u).filter(Boolean);
  const first = words[0] ?? "";
  const last = words.length > 1 ? (words.at(-1) ?? "") : "";
  return (last ? `${first.charAt(0)}${last.charAt(0)}` : first.slice(0, 2)).toUpperCase();
}
