import { describe, expect, test } from "bun:test";
import type { GitHistoryCommit } from "@openducktor/contracts";
import {
  authorInitials,
  formatCompactCommitAge,
  formatExactCommitDate,
  formatRelativeCommitDate,
  type GraphEdge,
  layoutHistoryGraph,
} from "./git-history-graph-model";

const oid = (name: string) => name.padEnd(40, "0");
const DEDICATED = { tipLane: "dedicated" } as const;
/** The lane and side of each edge. Color tests check colors on their own. */
const lines = (edges: readonly GraphEdge[] | undefined) =>
  edges?.map(({ lane, tone }) => ({ lane, tone }));

const commit = (
  name: string,
  parents: string[],
  membership: GitHistoryCommit["membership"],
  outside: string[] = [],
): GitHistoryCommit => ({
  oid: oid(name),
  parentOids: parents.map(oid),
  outsideParentOids: outside.map(oid),
  membership,
  subject: name,
  message: name,
  authorName: "Ada",
  authorEmail: "ada@example.invalid",
  refs: [],
  authorDate: "2026-10-13T14:05:22+02:00",
});

describe("layoutHistoryGraph", () => {
  test("keeps a linear branch in one lane and ends at the comparison limit", () => {
    const layout = layoutHistoryGraph(
      [
        commit("c2", ["c1"], "current"),
        commit("c1", ["base"], "current"),
        commit("base", ["old"], "boundary", ["old"]),
      ],
      DEDICATED,
    );

    expect(layout.laneCount).toBe(1);
    expect(layout.rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(lines(layout.rows[0]?.incoming)).toEqual([]);
    expect(lines(layout.rows[1]?.incoming)).toEqual([{ lane: 0, tone: "current" }]);
    expect(lines(layout.rows[2]?.outgoing)).toEqual([]);
    expect(layout.rows[2]?.reachesLimit).toBe(true);
  });

  test("draws both sides of the comparison and joins them at the shared base", () => {
    const layout = layoutHistoryGraph(
      [
        commit("current", ["base"], "current"),
        commit("target", ["base"], "target"),
        commit("base", [], "boundary"),
      ],
      DEDICATED,
    );

    const [current, target, base] = layout.rows;
    expect(current?.lane).toBe(0);
    expect(target?.lane).toBe(1);
    expect(lines(target?.passThrough)).toEqual([{ lane: 0, tone: "current" }]);
    // Each side leaves its commit from below and keeps its lane down to the shared base.
    expect(lines(target?.outgoing)).toEqual([{ lane: 1, tone: "target" }]);
    expect(base?.lane).toBe(0);
    expect(lines(base?.incoming)).toEqual([
      { lane: 0, tone: "current" },
      { lane: 1, tone: "target" },
    ]);
    expect(base?.reachesLimit).toBe(false);
    expect(layout.laneCount).toBe(2);
  });

  test("opens a lane for the second parent of a merge and colors it by that parent", () => {
    const layout = layoutHistoryGraph(
      [
        commit("merge", ["feature", "main"], "current"),
        commit("feature", ["base"], "current"),
        commit("main", ["base"], "boundary"),
        commit("base", [], "boundary"),
      ],
      DEDICATED,
    );

    const [merge, feature, main] = layout.rows;
    expect(lines(merge?.outgoing)).toEqual([
      { lane: 0, tone: "current" },
      { lane: 1, tone: "boundary" },
    ]);
    expect(lines(feature?.passThrough)).toEqual([{ lane: 1, tone: "boundary" }]);
    expect(main?.lane).toBe(1);
    expect(lines(main?.incoming)).toEqual([{ lane: 1, tone: "boundary" }]);
  });

  test("opens a new lane right of the merged commits for a branch tip below them", () => {
    const layout = layoutHistoryGraph(
      [
        commit("main", ["base", "pr2"], "target"),
        commit("pr2", ["pr1"], "target"),
        commit("pr1", ["base"], "target"),
        commit("c2", ["c1"], "current"),
        commit("c1", ["base"], "current"),
        commit("base", [], "boundary"),
      ],
      DEDICATED,
    );

    // The branch tip starts right of the merged commits, and every line reaches the base.
    expect(layout.rows.map((row) => row.lane)).toEqual([0, 1, 1, 2, 2, 0]);
    expect(lines(layout.rows[3]?.passThrough)).toEqual([
      { lane: 0, tone: "target" },
      { lane: 1, tone: "target" },
    ]);
    expect(lines(layout.rows[4]?.outgoing)).toEqual([{ lane: 2, tone: "current" }]);
    expect(lines(layout.rows[5]?.incoming)).toEqual([
      { lane: 0, tone: "target" },
      { lane: 1, tone: "target" },
      { lane: 2, tone: "current" },
    ]);
    expect(layout.laneCount).toBe(3);
  });

  test.each([
    ["dedicated", [0, 1, 0, 2, 0], 3],
    ["firstFree", [0, 1, 0, 1, 0], 2],
  ] as const)("starts a branch tip in a %s lane", (tipLane, expectedLanes, laneCount) => {
    // The merged branch ends at m1, so lane 1 is free when the branch tip comes.
    const layout = layoutHistoryGraph(
      [
        commit("main", ["m1", "pr1"], "target"),
        commit("pr1", ["m1"], "target"),
        commit("m1", ["base"], "target"),
        commit("c1", ["base"], "current"),
        commit("base", [], "boundary"),
      ],
      { tipLane },
    );

    expect(layout.rows.map((row) => row.lane)).toEqual([...expectedLanes]);
    expect(layout.laneCount).toBe(laneCount);
  });

  test("keeps the main line in its lane when a branch tip waits for the same base", () => {
    const layout = layoutHistoryGraph(
      [
        commit("main", ["m1", "pr1"], "target"),
        commit("pr1", ["m1"], "target"),
        commit("c1", ["base"], "current"),
        commit("m1", ["base", "pr2"], "target"),
        commit("pr2", ["base"], "target"),
        commit("base", [], "boundary"),
      ],
      DEDICATED,
    );

    // The branch tip takes lane 2, and the second merge uses the free lane 1 again.
    expect(layout.rows.map((row) => row.lane)).toEqual([0, 1, 2, 0, 1, 0]);
    // The main line stays in lane 0, and the branch joins it at the shared base.
    expect(lines(layout.rows[3]?.outgoing)).toEqual([
      { lane: 0, tone: "target" },
      { lane: 1, tone: "target" },
    ]);
    expect(lines(layout.rows[5]?.incoming)).toEqual([
      { lane: 0, tone: "target" },
      { lane: 1, tone: "target" },
      { lane: 2, tone: "current" },
    ]);
    expect(layout.laneCount).toBe(3);
  });

  test("keeps the color of every line when a new commit moves the lanes", () => {
    const merged = [
      commit("main", ["base", "pr2"], "target"),
      commit("pr2", ["pr1"], "target"),
      commit("pr1", ["base"], "target"),
      commit("c1", ["base"], "current"),
      commit("base", [], "boundary"),
    ];
    const before = layoutHistoryGraph(merged, DEDICATED);
    // A new branch commit, newer than the target tip, moves the branch to lane 0.
    const after = layoutHistoryGraph([commit("c2", ["c1"], "current"), ...merged], DEDICATED);

    const colorOf = (layout: typeof before, name: string) =>
      layout.rows.find((row) => row.commit.subject === name)?.color;
    expect(after.rows.find((row) => row.commit.subject === "c1")?.lane).not.toBe(
      before.rows.find((row) => row.commit.subject === "c1")?.lane,
    );
    for (const name of ["main", "pr2", "pr1", "c1"]) {
      expect(colorOf(after, name)).toBe(colorOf(before, name));
    }
    // Both tips use the main color of their side, and the merged line uses another color.
    expect(colorOf(after, "c2")).toBe(0);
    expect(colorOf(after, "main")).toBe(0);
    expect(colorOf(after, "pr2")).toBeGreaterThan(0);
  });

  test("leaves every commit from below toward its first parent", () => {
    const layout = layoutHistoryGraph(
      [
        commit("main", ["m1", "pr1"], "target"),
        commit("pr1", ["m1"], "target"),
        commit("c1", ["base"], "current"),
        commit("m1", ["base", "pr2"], "target"),
        commit("pr2", ["base"], "target"),
        commit("base", [], "boundary"),
      ],
      DEDICATED,
    );

    // Only a merge leaves its commit to the side. A first parent continues the commit's lane.
    for (const row of layout.rows.filter((entry) => entry.outgoing.length > 0)) {
      expect(row.outgoing[0]?.lane).toBe(row.lane);
    }
  });

  test("gives a tip outside the compared branches its own stable color", () => {
    // A rebase in progress: HEAD holds the replayed commit, and the branch keeps its old commit.
    const commits = [
      commit("replayed", ["main"], "current"),
      commit("old", ["base"], "current"),
      commit("main", ["base"], "target"),
      commit("base", [], "boundary"),
    ];
    const mainTips = new Set([oid("replayed"), oid("main")]);
    const layout = layoutHistoryGraph(commits, { tipLane: "dedicated", mainTips });
    const again = layoutHistoryGraph(commits, { tipLane: "dedicated", mainTips });

    const colorOf = (name: string) => layout.rows.find((row) => row.commit.subject === name)?.color;
    expect(colorOf("replayed")).toBe(0);
    expect(colorOf("old")).toBeGreaterThan(0);
    expect(again.rows.map((row) => row.color)).toEqual(layout.rows.map((row) => row.color));
  });

  test("keeps earlier rows unchanged when a later page adds rows", () => {
    const firstPage = [commit("c3", ["c2"], "current"), commit("c2", ["c1"], "current")];
    const secondPage = [commit("c1", ["base"], "current"), commit("base", [], "boundary")];

    const partial = layoutHistoryGraph(firstPage, DEDICATED);
    const complete = layoutHistoryGraph([...firstPage, ...secondPage], DEDICATED);

    expect(complete.rows.slice(0, 2)).toEqual(partial.rows);
    // A lane that waits for an unloaded parent continues to the bottom of the loaded rows.
    expect(lines(partial.rows[1]?.outgoing)).toEqual([{ lane: 0, tone: "current" }]);
  });
});

describe("commit dates", () => {
  test("keeps the author's clock time and offset", () => {
    expect(formatExactCommitDate("2026-10-13T14:05:22+02:00")).toBe("2026-10-13 14:05:22 +02:00");
    expect(formatExactCommitDate("2026-10-13T14:05:22Z")).toBe("2026-10-13 14:05:22 +00:00");
  });

  test("describes the age of a commit", () => {
    const now = Date.parse("2026-10-13T15:05:22+02:00");
    expect(formatRelativeCommitDate("2026-10-13T14:05:22+02:00", now)).toBe("1 hour ago");
    expect(formatRelativeCommitDate("2026-10-11T15:05:22+02:00", now)).toBe("2 days ago");
    expect(formatRelativeCommitDate("2026-10-13T15:05:00+02:00", now)).toBe("this minute");
  });
});

describe("compact commit ages", () => {
  const now = Date.parse("2026-10-13T15:05:22+02:00");

  test("uses the largest whole unit", () => {
    expect(formatCompactCommitAge("2026-10-13T15:05:00+02:00", now)).toBe("now");
    expect(formatCompactCommitAge("2026-10-13T14:55:22+02:00", now)).toBe("10m");
    expect(formatCompactCommitAge("2026-10-13T12:05:22+02:00", now)).toBe("3h");
    expect(formatCompactCommitAge("2026-10-11T15:05:22+02:00", now)).toBe("2d");
    expect(formatCompactCommitAge("2026-09-29T15:05:22+02:00", now)).toBe("2w");
    expect(formatCompactCommitAge("2026-06-13T15:05:22+02:00", now)).toBe("4mo");
    expect(formatCompactCommitAge("2024-10-13T15:05:22+02:00", now)).toBe("2y");
  });

  test("shows a commit dated in the future as new", () => {
    expect(formatCompactCommitAge("2026-10-14T15:05:22+02:00", now)).toBe("now");
  });
});

describe("authorInitials", () => {
  test("takes the first and last name", () => {
    expect(authorInitials("Maxime Ribera")).toBe("MR");
    expect(authorInitials("  ada  king lovelace ")).toBe("AL");
  });

  test("takes two letters of a single name", () => {
    expect(authorInitials("dependabot[bot]")).toBe("DE");
    expect(authorInitials("x")).toBe("X");
  });
});
